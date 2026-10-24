/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.execution.OperationCompletion;
import com.moaagent.agent.execution.OperationCompletionContext;
import com.moaagent.agent.execution.OperationCompletionListener;
import com.moaagent.agent.execution.OperationCompletionPublisher;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.moaagent.agent.continuation.IntentSwitch;
import com.moaagent.agent.interaction.ConfirmationResponses;
import com.moaagent.agent.interaction.FrontendEventType;
import com.moaagent.agent.interaction.narration.NarrationOutput;
import com.moaagent.agent.interaction.narration.ProgressNarrationCoordinator;
import com.moaagent.agent.leadout.ServiceLeadOutMetadata;
import com.moaagent.agent.routing.context.RequestEnvelope;
import com.moaagent.agent.skill.environment.ScriptEnvironmentContext.Stage;
import com.moaagent.agent.support.Json;
import com.moaagent.agent.support.RequestContextAccessor;
import com.openjiuwen.core.foundation.llm.schema.ToolCall;
import com.openjiuwen.core.singleagent.interrupt.InterruptRequest;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.harness.rails.interrupt.BaseInterruptRail;
import com.openjiuwen.harness.rails.interrupt.InterruptDecision;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 处理 Skill 业务操作的参数校验、确认、委派、脚本加工及执行结果。
 *
 * @since 0.1.0
 */
public final class SkillActionRail extends BaseInterruptRail {
    private static final Logger LOG = LoggerFactory.getLogger(SkillActionRail.class);

    private final SkillNarration narration;
    private final SkillEvents events;

    private final SkillAssets assets;
    private final Map<String, SkillOperation> operations;
    private final Map<String, String> contracts;
    private final SkillScriptRunner scripts;
    private final OperationCompletionPublisher completions;

    public SkillActionRail(SkillAssets assets, Map<String, SkillOperation> operations, SkillScriptRunner scripts) {
        this(assets, operations, scripts, List.of());
    }

    public SkillActionRail(SkillAssets assets, Map<String, SkillOperation> operations, SkillScriptRunner scripts,
            List<OperationCompletionListener> completionListeners) {
        this(assets, operations, scripts, ProgressNarrationCoordinator.disabled(), completionListeners);
    }

    public SkillActionRail(SkillAssets assets, Map<String, SkillOperation> operations, SkillScriptRunner scripts,
            ProgressNarrationCoordinator progress,
            List<OperationCompletionListener> completionListeners) {
        this(assets, operations, scripts,
                new SkillNarration(progress, NarrationOutput.sessionStream(), operations), new SkillEvents(),
                completionListeners);
    }

    SkillActionRail(SkillAssets assets, Map<String, SkillOperation> operations, SkillScriptRunner scripts,
            SkillNarration narration, SkillEvents events,
            List<OperationCompletionListener> completionListeners) {
        super(SkillTools.NAMES);
        this.narration = narration;
        this.events = events;
        setPriority(1500);
        this.assets = assets;
        this.operations = Map.copyOf(operations);
        this.scripts = scripts;
        this.completions = new OperationCompletionPublisher(completionListeners);
        operations.forEach((name, operation) -> {
            require(name.matches("[A-Za-z][A-Za-z0-9_-]{0,63}"), "操作名称无效");
            if (operation.resultScript() != null) {
                assets.script(operation.resultScript());
            }
            if (operation.beforeScript() != null) {
                assets.script(operation.beforeScript());
            }
            operation.inputBindings().values().forEach(binding ->
                    require(operations.containsKey(binding.operation()), "结果绑定引用未授权操作"));
            if (operation.internal()) {
                SkillSchema.validate(operation.modelInputSchema(), Map.of());
            }
            operationChain(name);
        });
        Map<String, String> fingerprints = new LinkedHashMap<>();
        operations.keySet().forEach(name -> fingerprints.put(name, contractFingerprint(name)));
        this.contracts = Map.copyOf(fingerprints);
    }

    private String contractFingerprint(String root) {
        var definitions = operationChain(root).stream().map(name -> {
            SkillOperation operation = operations.get(name);
            return Map.of("name", name, "operation", operation,
                    "before", operation.beforeScript() == null ? "" : assets.script(operation.beforeScript()),
                    "result", operation.resultScript() == null ? "" : assets.script(operation.resultScript()));
        }).toList();
        try {
            byte[] data = Json.MAPPER.copy()
                    .enable(com.fasterxml.jackson.databind.SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS)
                    .writeValueAsBytes(definitions);
            return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(data));
        } catch (JsonProcessingException | java.security.NoSuchAlgorithmException exception) {
            throw new IllegalArgumentException("无法固定组合操作定义", exception);
        }
    }

    private List<String> operationChain(String root) {
        var chain = new java.util.ArrayList<String>();
        String name = root;
        int delegates = 0;
        while (name != null) {
            require(!chain.contains(name) && chain.size() < 32, "组合操作存在循环或步骤过多");
            SkillOperation operation = operations.get(name);
            require(operation != null, "组合操作引用未授权操作");
            if (!chain.isEmpty()) {
                require(operation.internal(), "自动衔接只能执行内部操作");
            }
            delegates += operation.type() == SkillOperation.Type.A2A ? 1 : 0;
            require(delegates <= 1, "组合操作最多包含一个远端等待步骤");
            chain.add(name);
            name = operation.nextOperation();
        }
        return List.copyOf(chain);
    }

    @Override
    protected Object getUserInput(AgentCallbackContext ctx, ToolCall toolCall) {
        String toolCallId = toolCall.getId();
        Object raw = ctx.getExtra().get(com.openjiuwen.core.singleagent.interrupt.InterruptConstants
                .RESUME_USER_INPUT_KEY);
        Object answer;
        if (raw instanceof com.openjiuwen.core.session.interaction.InteractiveInput input) {
            answer = input.getUserInputs().get(toolCallId);
        } else {
            answer = raw instanceof Map<?, ?> inputs ? inputs.get(toolCallId) : null;
        }
        // 仅用户确认文本解包；call_versatile 等下游业务回执必须保持原样。
        if (ctx.getInputs() instanceof com.openjiuwen.core.singleagent.rail.ToolCallInputs inputs
                && Set.of("confirm_action", "cancel_skill").contains(inputs.getToolName())
                && answer instanceof String text) {
            return RequestEnvelope.query(text);
        }
        return answer;
    }

    @Override
    protected InterruptDecision resolveInterrupt(AgentCallbackContext ctx, ToolCall call, Object response) {
        SkillSession state = SkillSession.load(ctx.getSession())
                .orElseThrow(() -> new IllegalArgumentException("Skill 执行不处于活动状态"));
        if (Set.of("SUCCESS", "COMPLETED", "FAILED", "CANCELLED").contains(state.getState())) {
            SkillBoundaryRail.finish(ctx, state.getOutcome());
            return reject(Json.write(state.getOutcome()));
        }
        require("ACTIVE".equals(state.getState()), "Skill 执行不处于活动状态");
        require(state.getResultPolicyVersion() == 1, "旧结果策略需要新的执行会话");
        require(call.getId() != null && !call.getId().isBlank(), "工具调用缺少标识");
        ActionTrace trace = new ActionTrace();
        try {
            if (state.getReceipts().containsKey(call.getId())) {
                return replayReceipt(state, call);
            }
            Map<String, Object> args = SkillSchema.object(Json.MAPPER.readValue(call.getArguments(), Object.class));
            Optional<InterruptDecision> control = controlAction(ctx, state, call, response, args);
            return control.orElseGet(() -> executeBusiness(new ActionContext(ctx, state, call),
                    response, args, trace));
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            return rejectAction(ctx, state, call, trace, exception);
        } catch (Exception exception) {
            return rejectAction(ctx, state, call, trace, exception);
        }
    }

    private Optional<InterruptDecision> controlAction(AgentCallbackContext ctx, SkillSession state, ToolCall call,
            Object response, Map<String, Object> args) {
        return switch (String.valueOf(call.getName())) {
            case "read_file" -> {
                require(args.keySet().equals(Set.of("file_path")), "资源读取参数无效");
                String path = String.valueOf(args.get("file_path"));
                require(path.endsWith(".md"), "模型仅可读取 Skill Markdown 资料");
                yield Optional.of(reject(assets.read(path)));
            }
            case "skill_results" -> Optional.of(reject(Json.write(modelResults(state, args))));
            case "cancel_skill" -> Optional.of(cancel(ctx, state, call, response));
            default -> Optional.empty();
        };
    }

    private Map<String, Object> modelResults(SkillSession state, Map<String, Object> args) {
        require(args.isEmpty() || args.keySet().equals(Set.of("operation")), "结果查询参数无效");
        if (!args.isEmpty()) {
            return publicResult(state, String.valueOf(args.get("operation")));
        }
        Map<String, Object> index = new LinkedHashMap<>();
        operations.forEach((name, operation) -> {
            if (!operation.internal() && state.getModelResults().containsKey(name)) {
                Map<String, Object> result = publicResult(state, name);
                index.put(name, Map.of("version", result.get("version"), "result_ref", result.get("result_ref")));
            }
        });
        return Map.of("revision", state.getRevision(), "results", index);
    }

    private Map<String, Object> publicResult(SkillSession state, String name) {
        SkillOperation operation = operations.get(name);
        require(operation != null && !operation.internal(), "结果查询未获授权");
        require(state.getModelResults().containsKey(name), "操作尚无模型摘要");
        return validatePublicResult(name, SkillSchema.object(state.getModelResults().get(name)));
    }

    private Map<String, Object> validatePublicResult(String name, Map<String, Object> result) {
        require(result.keySet().equals(Set.of("success", "operation", "version", "result_ref", "summary"))
                && name.equals(result.get("operation")), "模型回执无效");
        SkillOperation operation = operations.get(name);
        require(operation != null && !operation.internal(), "模型回执未获授权");
        SkillSchema.validate(operation.summarySchema(), result.get("summary"));
        return result;
    }

    private InterruptDecision replayReceipt(SkillSession state, ToolCall call) {
        Map<String, Object> saved = SkillSchema.object(state.getReceipts().get(call.getId()));
        if (!saved.containsKey("response")) {
            return reject(Json.write(Map.of("success", false, "error", "LEGACY_RECEIPT_REQUIRES_NEW_EXECUTION")));
        }
        require(call.getName().equals(saved.get("tool")) && call.getArguments().equals(saved.get("request")),
                "调用标识不可用于不同请求");
        Map<String, Object> response = SkillSchema.object(saved.get("response"));
        if (response.containsKey("summary")) {
            validatePublicResult(String.valueOf(response.get("operation")), response);
        }
        return reject(Json.write(response));
    }

    private InterruptDecision cancel(AgentCallbackContext ctx, SkillSession state, ToolCall call, Object response) {
        if (response == null) {
            return question(ctx, call, "是否取消当前任务？已完成的业务不会自动撤销。", Map.of());
        }
        if (ConfirmationResponses.approved(response)) {
            String message = "已取消当前任务，不再执行后续步骤。已完成的业务不会自动撤销。";
            narration.stop(ctx.getSession(), "cancelled");
            events.emit(ctx, FrontendEventType.FINAL_ANSWER_CHUNK, Map.of("content", message));
            return finish(ctx, state, false, "cancelled", Map.of("reason", "USER_CANCELLED", "message", message));
        }
        events.emit(ctx, FrontendEventType.FINAL_ANSWER_CHUNK, Map.of("content", "未取消当前任务，将继续办理。"));
        return receipt(ctx, state, call, Map.of("cancelled", false));
    }

    private BusinessAction readAction(Map<String, Object> args, SkillSession state, ActionTrace trace) {
        require(args.keySet().equals(Set.of("operation", "arguments")), "业务工具参数无效");
        String name = String.valueOf(args.get("operation"));
        SkillOperation operation = operations.get(name);
        require(operation != null && !operation.internal(), "操作未获模型调用授权");
        trace.operationName = name;
        trace.rootName = name;
        Map<String, Object> arguments = SkillSchema.object(args.get("arguments"));
        SkillSchema.validate(operation.modelInputSchema(), arguments);
        return new BusinessAction(name, operation, arguments, "", name, arguments, Map.of());
    }

    private BusinessAction bindAction(SkillSession state, BusinessAction request, String name) {
        SkillOperation operation = operations.get(name);
        Map<String, Object> arguments = new LinkedHashMap<>(name.equals(request.rootName())
                ? request.rootArguments() : Map.of());
        arguments.putAll(operation.fixedArguments());
        Map<String, Integer> versions = new LinkedHashMap<>();
        operation.inputBindings().forEach((field, binding) -> {
            Integer version = state.getResultVersions().get(binding.operation());
            require(version != null && version > 0 && state.getResults().containsKey(binding.operation()),
                    "后台输入绑定缺少已验证结果");
            var value = Json.MAPPER.valueToTree(state.getResults().get(binding.operation())).at(binding.path());
            require(!value.isMissingNode() && !value.isNull(), "后台输入绑定字段缺失");
            arguments.put(field, Json.MAPPER.convertValue(value, Object.class));
            versions.put(binding.operation(), version);
        });
        SkillSchema.validate(operation.inputSchema(), arguments);
        String approval = Json.write(List.of(name, new java.util.TreeMap<>(arguments), state.getRevision(),
                contracts.get(request.rootName())));
        return new BusinessAction(name, operation, arguments, approval, request.rootName(), request.rootArguments(),
                versions);
    }

    private BusinessAction restoreAction(SkillSession state, BusinessAction request, Map<String, Object> saved) {
        require(request.rootName().equals(saved.get("root"))
                && request.rootArguments().equals(saved.get("root_arguments")), "业务回调与原始请求不匹配");
        require(operationChain(request.rootName()).equals(saved.get("chain")), "等待中的组合定义已变化");
        require(contracts.get(request.rootName()).equals(saved.get("contract")), "等待中的执行契约或脚本已变化");
        String name = String.valueOf(saved.get("operation"));
        require(operationChain(request.rootName()).contains(name), "等待中的步骤未获授权");
        require(Integer.valueOf(state.getRevision()).equals(saved.get("revision")), "等待期间业务结果已变化");
        Map<String, Object> sourceVersions = SkillSchema.object(saved.get("binding_versions"));
        sourceVersions.forEach((source, version) ->
                require(version.equals(state.getResultVersions().get(source)), "绑定结果版本已过期"));
        SkillOperation operation = operations.get(name);
        Map<String, Object> arguments = SkillSchema.object(saved.get("arguments"));
        SkillSchema.validate(operation.inputSchema(), arguments);
        return new BusinessAction(name, operation, arguments, "", request.rootName(),
                request.rootArguments(), Map.of());
    }

    private InterruptDecision executeBusiness(ActionContext context,
            Object response, Map<String, Object> args, ActionTrace trace) {
        AgentCallbackContext ctx = context.ctx();
        SkillSession state = context.state();
        ToolCall call = context.call();
        BusinessAction request = readAction(args, state, trace);
        if ("confirm_action".equals(call.getName())) {
            return confirm(ctx, state, call, response, bindAction(state, request, request.name()));
        }
        require(request.operation().type() == ("call_versatile".equals(call.getName()) ? SkillOperation.Type.A2A
                : SkillOperation.Type.SCRIPT),
                "操作与工具类型不匹配");
        Map<String, Object> saved = Json.object(state.getPending().get(call.getId()));
        BusinessAction action;
        if (response != null) {
            trace.businessStarted = !saved.isEmpty();
            action = restoreAction(state, request, saved);
            trace.operationName = action.name();
            var decision = validateCallback(context, response, action, saved, trace);
            if (decision.isPresent()) {
                return decision.get();
            }
        } else {
            action = bindAction(state, request, request.name());
        }
        Object currentResponse = response;
        while (true) {
            trace.operationName = action.name();
            if (currentResponse == null) {
                var decision = startOperation(ctx, state, call, action, trace);
                if (decision.isPresent()) {
                    return decision.get();
                }
            }
            var decision = processResult(context, currentResponse, action, trace);
            if (decision.isPresent()) {
                return decision.get();
            }
            action = bindAction(state, request, action.operation().nextOperation());
            currentResponse = null;
        }
    }

    private InterruptDecision confirm(AgentCallbackContext ctx, SkillSession state, ToolCall call,
            Object response, BusinessAction action) {
        require(action.operation().confirmationRequired(), "该操作不需要确认");
        if (response == null) {
            state.getApprovals().put("pending:" + call.getId(), action.approval());
            state.save(ctx.getSession());
            return question(ctx, call, SkillConfirmation.render(operations.get(action.rootName()),
                    action.rootArguments()), action.rootArguments());
        }
        require(action.approval().equals(state.getApprovals().remove("pending:" + call.getId())), "确认上下文已变化");
        boolean accepted = ConfirmationResponses.approved(response);
        if (accepted) {
            state.getApprovals().put(action.name(), action.approval());
        }
        return receipt(ctx, state, call, Map.of("approved", accepted));
    }

    private Optional<InterruptDecision> startOperation(AgentCallbackContext ctx, SkillSession state, ToolCall call,
            BusinessAction action, ActionTrace trace) {
        String name = action.name();
        SkillOperation operation = action.operation();
        Map<String, Object> arguments = action.arguments();
        require(state.getPending().isEmpty(), "已有业务调用正在等待结果");
        require(state.getCalls().getOrDefault(name, 0) < operation.maxCalls(), "操作调用次数超限");
        require(!operation.confirmationRequired() || action.approval().equals(state.getApprovals().remove(name)),
                "必须确认当前操作、参数与结果版本");
        trace.stage = "prepare_input";
        var input = scriptInput(ctx, state, arguments, operation, Map.of());
        validateBeforeScript(new ActionContext(ctx, state, call), action, input, trace);
        Map<String, Object> saved = Map.of("operation", name, "arguments", arguments,
                "root", action.rootName(), "root_arguments", action.rootArguments(),
                "binding_versions", action.bindingVersions(), "revision", state.getRevision(),
                "chain", operationChain(action.rootName()), "contract", contracts.get(action.rootName()));
        state.getCalls().merge(name, 1, Integer::sum);
        state.getPending().put(call.getId(), saved);
        state.getModelResults().remove(action.rootName());
        state.save(ctx.getSession());
        trace.businessStarted = true;
        trace.stage = "emit_start";
        narration.stop(ctx.getSession(), "tool_handoff");
        events.step(ctx, state, call.getId(), operation, "RUNNING");
        LOG.info("[SKILL-ACTION] execution={} operation={} action=start type={}", state.getExecutionId(), name,
                operation.type());
        if (operation.type() != SkillOperation.Type.A2A) {
            narration.operation(ctx.getSession(), name, operation);
            return Optional.empty();
        }
        // L2 自身负责业务交互；本地提示已收尾，不播报技术委派过程、不跨中断定时写流。
        trace.stage = "prepare_delegate";
        String query = render(operation.queryTemplate(), arguments);
        var request = new InterruptRequest(Json.write(Map.of("query", query, "intent", operation.intent(),
                        "idempotencyKey", state.getExecutionId() + ":" + call.getId() + ":" + name)), Map.of(), "");
        request.putExtraField("_interrupt_kind", "a2a_delegate");
        request.putExtraField("agentName", operation.adapter());
        LOG.info("[SKILL-ACTION] execution={} call={} operation={} stage=delegate_requested adapter={} intent={}",
                state.getExecutionId(), call.getId(), name, operation.adapter(), operation.intent());
        return Optional.of(interrupt(request));
    }

    private void validateBeforeScript(ActionContext context,
            BusinessAction action, Map<String, Object> input, ActionTrace trace) {
        AgentCallbackContext ctx = context.ctx();
        SkillSession state = context.state();
        ToolCall call = context.call();
        SkillOperation operation = action.operation();
        if (operation.beforeScript() == null) {
            return;
        }
        trace.stage = "before_script";
        LOG.info("[SKILL-ACTION] execution={} call={} operation={} stage={} action=begin",
                state.getExecutionId(), call.getId(), action.name(), trace.stage);
        // 前置校验是内部步骤，沿用当前业务提示，不单独播报脚本或校验层次。
        Map<String, Object> validation = scripts.run(ctx.getSession(), assets.script(operation.beforeScript()), input,
                operation.scriptEnvironment().context(action.name(), Stage.BEFORE_SCRIPT));
        trace.processorCode = processorCode(validation);
        require(Boolean.TRUE.equals(validation.get("allow")), "业务前置条件未满足");
        trace.processorCode = "none";
    }

    private Optional<InterruptDecision> validateCallback(ActionContext context,
            Object response, BusinessAction action, Map<String, Object> saved, ActionTrace trace) {
        AgentCallbackContext ctx = context.ctx();
        SkillSession state = context.state();
        ToolCall call = context.call();
        trace.stage = "validate_callback";
        LOG.info(("[SKILL-ACTION] execution={} call={} operation={} "
                + "stage=delegate_returned responseType={} responseLength={}"),
                state.getExecutionId(), call.getId(), action.name(), response.getClass().getSimpleName(),
                response instanceof String text ? text.length() : -1);
        require(action.operation().type() == SkillOperation.Type.A2A && action.name().equals(saved.get("operation"))
                && action.arguments().equals(saved.get("arguments")), "业务回调与挂起调用不匹配");
        if (!IntentSwitch.detected(response)) {
            return Optional.empty();
        }
        events.step(ctx, state, call.getId(), action.operation(), "SUSPENDED");
        Map<String, Object> outcome = SkillIntentSwitchRail.suspend(ctx, response);
        SkillBoundaryRail.finish(ctx, outcome);
        return Optional.of(reject(Json.write(outcome)));
    }

    private void notifyCompletion(ActionContext context, String operation,
            java.util.function.Supplier<OperationCompletion.Result> result) {
        SkillSession state = context.state();
        String callId = context.call().getId();
        completions.publish(() -> new OperationCompletion(
                new OperationCompletion.Identity(state.getExecutionId(),
                        state.getExecutionId() + ":" + callId + ":" + operation,
                        state.getExecutionId(), state.getParentId()),
                new OperationCompletion.Operation(operation, operations.get(operation).type() == SkillOperation.Type.A2A
                        ? OperationCompletion.Source.SKILL_A2A : OperationCompletion.Source.SKILL_SCRIPT),
                result.get(), RequestContextAccessor.metadata(context.ctx().getSession())),
                () -> new OperationCompletionContext(context.ctx().getSession(), operations.get(operation).title()));
    }

    private Optional<InterruptDecision> processResult(ActionContext context,
            Object response, BusinessAction action, ActionTrace trace) {
        AgentCallbackContext ctx = context.ctx();
        SkillSession state = context.state();
        ToolCall call = context.call();
        String name = action.name();
        SkillOperation operation = action.operation();
        ProcessedResult processed = evaluateResult(context, response, action, trace);
        Map<String, Object> data = processed.data();
        Map<String, Object> summary = processed.summary();
        String message = processed.message();
        trace.stage = "save_result";
        saveSuccessfulResult(context, action, processed);
        LOG.info("[SKILL-ACTION] execution={} operation={} action=complete revision={}", state.getExecutionId(),
                name, state.getRevision());
        if (operation.nextOperation() != null) {
            state.save(ctx.getSession());
            return Optional.empty();
        }
        // nextOperation 链结束后，以入口 operation 生成模型回执；回执使用当前 revision，各步骤结果版本保持不变。
        Map<String, Object> result = Map.of("success", true, "operation", action.rootName(),
                "version", state.getRevision(), "result_ref", action.rootName() + "@" + state.getRevision(),
                "summary", summary);
        state.getModelResults().put(action.rootName(), result);
        InterruptDecision decision = receipt(ctx, state, call, result);
        notifyCompletion(context, action.rootName(),
                () -> new OperationCompletion.Result(OperationCompletion.ExecutionStatus.SUCCEEDED, data, result));
        if (operations.get(action.rootName()).terminal()) {
            return Optional.of(finish(ctx, state, true, "success", result));
        }
        return Optional.of(decision);
    }

    private void saveSuccessfulResult(ActionContext context, BusinessAction action, ProcessedResult processed) {
        AgentCallbackContext ctx = context.ctx();
        SkillSession state = context.state();
        ToolCall call = context.call();
        SkillOperation operation = action.operation();
        Map<String, Object> responseMetadata = operation.type() == SkillOperation.Type.A2A
                ? ServiceLeadOutMetadata.forToolCall(ctx.getSession(), call.getId())
                : ServiceLeadOutMetadata.project(processed.data());
        state.setResponseMetadata(ServiceLeadOutMetadata.merge(state.getResponseMetadata(), responseMetadata));
        state.getResults().put(action.name(), processed.data());
        // 为每个实际步骤记录可信结果版本；脚本的 *_version 引用它来校验依赖，不用于幂等。
        state.setRevision(state.getRevision() + 1);
        state.getResultVersions().put(action.name(), state.getRevision());
        state.getApprovals().clear();
        state.getPending().remove(call.getId());
        narration.stop(ctx.getSession(), "completed");
        events.step(ctx, state, call.getId(), operation, "SUCCEEDED");
        if (processed.message() != null) {
            events.emit(ctx, FrontendEventType.FINAL_ANSWER_CHUNK, Map.of("content", processed.message()));
        }
    }

    private ProcessedResult evaluateResult(ActionContext context, Object response,
            BusinessAction action, ActionTrace trace) {
        AgentCallbackContext ctx = context.ctx();
        SkillSession state = context.state();
        ToolCall call = context.call();
        String name = action.name();
        SkillOperation operation = action.operation();
        trace.stage = "result_input";
        var resultInput = scriptInput(ctx, state, action.arguments(), operation, response == null ? Map.of()
                : response);
        narration.operation(ctx.getSession(), name, operation);
        Map<String, Object> data;
        Map<String, Object> summary;
        String message = null;
        if (operation.resultScript() == null) {
            trace.stage = "structured_result";
            data = structuredResult(response);
            summary = Map.of();
        } else {
            trace.stage = "result_script";
            LOG.info("[SKILL-ACTION] execution={} call={} operation={} stage={} action=begin",
                    state.getExecutionId(), call.getId(), name, trace.stage);
            Map<String, Object> processed = scripts.run(ctx.getSession(), assets.script(operation.resultScript()),
                    resultInput, operation.scriptEnvironment().context(name, Stage.RESULT_SCRIPT));
            trace.stage = "result_processor";
            trace.processorCode = processorCode(processed);
            require(Boolean.TRUE.equals(processed.get("success")), "业务结果未通过处理器校验");
            trace.processorCode = "none";
            data = SkillSchema.object(processed.get("data"));
            summary = operation.nextOperation() == null
                    ? (processed.containsKey("model_data") ? SkillSchema.object(processed.get("model_data")) : null)
                    : Map.of();
            if (processed.get("message") instanceof String text && !text.isBlank() && text.length() <= 4096) {
                message = text;
            }
        }
        trace.stage = "result_schema";
        SkillSchema.validate(operation.outputSchema(), data);
        trace.stage = "result_size";
        require(Json.write(data).length() <= 65536, "业务结果超限");
        if (operation.nextOperation() == null) {
            trace.stage = "model_result_schema";
            SkillOperation root = operations.get(action.rootName());
            if (operation.resultScript() == null || summary == null) {
                summary = project(data, root.summarySchema());
            }
            SkillSchema.validate(root.summarySchema(), summary);
            require(Json.write(summary).length() <= 8192, "模型摘要超限");
        }
        return new ProcessedResult(data, summary, message);
    }

    private record ProcessedResult(Map<String, Object> data, Map<String, Object> summary, String message) { }

    private static Map<String, Object> structuredResult(Object response) {
        Object value = response;
        if (response instanceof String text) {
            try {
                value = Json.MAPPER.readValue(text, Object.class);
            } catch (JsonProcessingException exception) {
                throw new IllegalArgumentException("无 result-script 时下游必须返回合法 JSON 对象", exception);
            }
        }
        return SkillSchema.object(value);
    }

    private static Map<String, Object> project(Map<String, Object> data, Map<String, Object> schema) {
        if (!"object".equals(schema.get("type"))) {
            return Map.of();
        }
        Map<String, Object> projected = new LinkedHashMap<>();
        SkillSchema.object(schema.get("properties")).forEach((name, child) -> {
            if (data.containsKey(name)) {
                projected.put(name, projectValue(data.get(name), SkillSchema.object(child)));
            }
        });
        return projected;
    }

    private static Object projectValue(Object value, Map<String, Object> schema) {
        if ("object".equals(schema.get("type")) && value instanceof Map<?, ?>) {
            return project(SkillSchema.object(value), schema);
        }
        if ("array".equals(schema.get("type")) && value instanceof List<?> list) {
            Map<String, Object> itemSchema = SkillSchema.object(schema.get("items"));
            return list.stream().map(item -> projectValue(item, itemSchema)).toList();
        }
        return value;
    }

    private InterruptDecision rejectAction(AgentCallbackContext ctx, SkillSession state, ToolCall call,
            ActionTrace trace, Exception exception) {
        narration.stop(ctx.getSession(), "failed");
        LOG.warn(("[SKILL-ACTION] execution={} call={} tool={} operation={} stage={} "
                + "action=reject errorType={} processorCode={} elapsedMs={}"),
                state.getExecutionId(), call.getId(), call.getName(), trace.operationName, trace.stage,
                exception.getClass().getSimpleName(), trace.processorCode,
                java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - trace.started));
        if (exception instanceof MissingRequestParameterException
                || trace.businessStarted || !state.getPending().isEmpty()) {
            var pending = Json.object(state.getPending().get(call.getId()));
            SkillOperation operation = pending.get("operation") instanceof String name ? operations.get(name) : null;
            if (operation != null) {
                events.step(ctx, state, call.getId(), operation, "FAILED");
            }
            String reason = exception instanceof MissingRequestParameterException
                    ? "MISSING_TRUSTED_REQUEST_PARAMETER" : "BUSINESS_EXECUTION_FAILED";
            Map<String, Object> failure = Map.of("success", false, "reason", reason,
                    "stage", trace.stage, "operation", trace.operationName);
            InterruptDecision decision = finish(ctx, state, false, "failed", failure);
            if (trace.businessStarted && operations.containsKey(trace.rootName)) {
                notifyCompletion(new ActionContext(ctx, state, call), trace.rootName,
                        () -> new OperationCompletion.Result(OperationCompletion.ExecutionStatus.FAILED, null,
                                failure));
            }
            return decision;
        }
        state.save(ctx.getSession());
        return reject(Json.write(Map.of("success", false, "error", "操作无效或未获授权，请检查参数、前置结果与确认")));
    }

    private record ActionContext(AgentCallbackContext ctx, SkillSession state, ToolCall call) {
    }

    private record BusinessAction(String name, SkillOperation operation, Map<String, Object> arguments, String
            approval, String rootName, Map<String, Object> rootArguments, Map<String, Integer> bindingVersions) {
    }

    private static final class ActionTrace {
        private String stage = "validate_request";
        private String operationName = "unresolved";
        private String rootName = "unresolved";
        private String processorCode = "none";
        private boolean businessStarted;
        private final long started = System.nanoTime();
    }

    private static final class MissingRequestParameterException extends IllegalArgumentException {
        private static final long serialVersionUID = 1L;

        private MissingRequestParameterException() {
            super("缺少受信任请求参数");
        }
    }

    private static String processorCode(Map<String, Object> result) {
        Object code = result == null ? null : result.get("error");
        return code instanceof String text && text.matches("[A-Z][A-Z0-9_]{0,63}") ? text : "none";
    }

    private Map<String, Object> scriptInput(AgentCallbackContext ctx, SkillSession state, Map<String, Object> args,
            SkillOperation operation, Object result) {
        Map<String, Object> metadata = new LinkedHashMap<>();
        if (!operation.metadataBindings().isEmpty()) {
            // 请求快照按需读取；只有操作声明的绑定字段可以进入沙箱脚本。
            Map<String, Object> trustedMetadata = RequestContextAccessor.metadata(ctx.getSession());
            var source = Json.MAPPER.valueToTree(trustedMetadata);
            operation.metadataBindings().forEach((name, pointer) -> {
                var value = source.at(pointer);
                if (value.isMissingNode() || value.isNull()) {
                    LOG.warn("[SKILL-ACTION] execution={} action=missing_metadata binding={} pointer={}",
                            state.getExecutionId(), name, pointer);
                    throw new MissingRequestParameterException();
                }
                metadata.put(name, Json.MAPPER.convertValue(value, Object.class));
            });
        }
        return Map.of("arguments", args, "results", Map.copyOf(state.getResults()), "versions", Map.copyOf(state
                .getResultVersions()),
                "metadata", metadata, "result", result, "execution_id", state.getExecutionId(), "revision", state
                        .getRevision());
    }

    private InterruptDecision question(AgentCallbackContext ctx, ToolCall call, String message, Map<String, Object>
            data) {
        InterruptRequest request = new InterruptRequest();
        String prompt = message + "\n" + ConfirmationResponses.hint();
        request.putExtraField("interrupt_id", call.getId());
        request.setMessage(prompt);
        request.putExtraField("questions", List.of(Map.of("question", prompt, "options", List.of("确认", "拒绝"))));
        request.setPayloadSchema(Map.of("type", "string"));
        request.putExtraField("tool_call_id", call.getId());
        request.putExtraField("tool_name", call.getName());
        return interrupt(request);
    }

    private InterruptDecision receipt(AgentCallbackContext ctx, SkillSession state, ToolCall call, Object value) {
        state.getReceipts().put(call.getId(), Map.of("tool", call.getName(), "request", call.getArguments(),
                "response", value));
        state.save(ctx.getSession());
        return reject(Json.write(value));
    }

    private InterruptDecision finish(AgentCallbackContext ctx, SkillSession state, boolean success, String status,
            Map<String, Object> data) {
        state.setState(status.toUpperCase(java.util.Locale.ROOT));
        state.getApprovals().clear();
        state.getPending().clear();
        state.setOutcome(Map.of("protocol", "native_skill_v1", "success", success, "status", status, "data", data));
        state.save(ctx.getSession());
        LOG.info("[SKILL-ACTION] execution={} action=finish status={} success={}", state.getExecutionId(), status,
                success);
        SkillBoundaryRail.finish(ctx, state.getOutcome());
        return reject(Json.write(state.getOutcome()));
    }

    private static String render(String template, Map<String, Object> arguments) {
        var matcher = java.util.regex.Pattern.compile("\\{([A-Za-z][A-Za-z0-9_]*)}").matcher(template);
        StringBuilder result = new StringBuilder();
        while (matcher.find()) {
            Object value = arguments.get(matcher.group(1));
            require(value != null, "请求模板缺少参数");
            matcher.appendReplacement(result, java.util.regex.Matcher.quoteReplacement(String.valueOf(value)));
        }
        matcher.appendTail(result);
        return result.toString();
    }

    private static void require(boolean value, String message) {
        if (!value) {
            throw new IllegalArgumentException(message);
        }
    }
}
