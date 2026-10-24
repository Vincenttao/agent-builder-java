/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.routing.context.DefaultModelContextContributor;
import com.moaagent.agent.routing.context.ModelContextContributor;
import com.moaagent.agent.routing.context.IntentHandoff;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.foundation.llm.schema.AssistantMessage;
import com.openjiuwen.core.session.AgentSessionApi;
import com.openjiuwen.core.session.interaction.InteractiveInput;
import com.openjiuwen.core.singleagent.interrupt.ToolInterruptionState;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.InvokeInputs;
import com.openjiuwen.core.singleagent.rail.ModelCallInputs;
import com.openjiuwen.core.singleagent.rail.ToolCallInputs;
import com.openjiuwen.core.singleagent.rail.AgentRail;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * 校验 Skill 执行身份和工具权限，并限制模型直接输出未经验证的结果。
 *
 * @since 0.1.0
 */
public final class SkillBoundaryRail extends AgentRail {
    private final Set<String> allowed = new HashSet<>(SkillTools.NAMES);
    private final boolean requiresVerifiedCompletion;
    private final ModelContextContributor contributor;

    public SkillBoundaryRail() {
        this(Map.of());
    }

    public SkillBoundaryRail(Map<String, SkillOperation> operations) {
        this(operations, new DefaultModelContextContributor());
    }

    public SkillBoundaryRail(Map<String, SkillOperation> operations,
            ModelContextContributor contributor) {
        this.contributor = java.util.Objects.requireNonNull(contributor);
        this.requiresVerifiedCompletion = operations.values().stream().anyMatch(SkillOperation::terminal);
        allowed.addAll(Set.of("ask_user", "list_skill", "switch_intent"));
    }

    @Override
    public int getPriority() {
        return 2000;
    }

    @Override
    public void beforeInvoke(AgentCallbackContext ctx) {
        if (!(ctx.getInputs() instanceof InvokeInputs input)) {
            return;
        }
        SkillSession state = SkillSession.load(ctx.getSession()).orElse(null);
        if (state != null && state.getResultPolicyVersion() != 1) {
            state.setState("FAILED");
            state.setOutcome(Map.of("protocol", "native_skill_v1", "success", false, "status", "failed",
                    "error", "RESULT_POLICY_UPGRADE_REQUIRES_NEW_EXECUTION"));
            state.save(ctx.getSession());
            finish(ctx, state.getOutcome());
            return;
        }
        Map<String, Object> envelope = Json.object(input.getQuery());
        boolean delegated = "native_skill_v1".equals(envelope.get("protocol"));
        String execution = delegated && envelope.get("idempotencyKey") instanceof String key ? key : "";
        validateDelegation(envelope, execution, delegated);
        if (ctx.getSession().getState(com.openjiuwen.core.singleagent.interrupt.InterruptConstants.INTERRUPTION_KEY) != null) {
            if (delegated) {
                throw new IllegalStateException("等待交互回复，不能用启动报文恢复");
            }
            return;
        }
        if (input.getQuery() instanceof InteractiveInput) {
            finish(ctx, Map.of("protocol", "native_skill_v1", "success", false, "status", "failed", "error",
                    "STALE_CALLBACK"));
            return;
        }
        if (continueExecution(ctx, state, envelope, execution, delegated)) {
            return;
        }
        if (delegated && ctx.getSession().getState("__skill_seen__" + execution) != null) {
            throw new IllegalStateException("历史执行标识不能重用");
        }
        state = new SkillSession();
        state.setExecutionId(delegated ? execution : UUID.randomUUID().toString());
        state.setParentId(delegated && envelope.get("todoId") instanceof String parent
                ? parent : "skill-" + state.getExecutionId());
        state.setQuery(delegated && envelope.get("query") instanceof String query ? query : String.valueOf(input.getQuery()));
        state.setTaskDisplayName(delegated && envelope.get("taskDisplayName") instanceof String name
                ? name : "");
        state.save(ctx.getSession());
        ctx.getSession().updateState(Map.of("__skill_seen__" + state.getExecutionId(), true));
    }

    private static void validateDelegation(Map<String, Object> envelope, String execution, boolean delegated) {
        if (!delegated) {
            return;
        }
        boolean validQuery = envelope.get("query") instanceof String query
                && !query.isBlank() && query.length() <= 16384;
        boolean validParent = envelope.get("todoId") instanceof String parent
                && parent.matches("[A-Za-z0-9_.:-]{1,128}");
        Object displayName = envelope.get("taskDisplayName");
        boolean validDisplayName = displayName == null || displayName instanceof String name
                && name.length() <= 256;
        if (!execution.matches("[A-Za-z0-9_.:-]{1,256}") || !validQuery || !validParent || !validDisplayName) {
            throw new IllegalArgumentException("Skill 委派缺少执行标识、父任务或请求");
        }
    }

    private static boolean continueExecution(AgentCallbackContext ctx, SkillSession state, Map<String, Object> envelope,
            String execution, boolean delegated) {
        if (state != null && delegated && execution.equals(state.getExecutionId())) {
            if (!envelope.get("query").equals(state.getQuery())) {
                throw new IllegalStateException("执行标识不可重用");
            }
            if (!"ACTIVE".equals(state.getState())) {
                finish(ctx, state.getOutcome());
            }
            return true;
        }
        if (state != null && "ACTIVE".equals(state.getState())) {
            if (delegated) {
                throw new IllegalStateException("已有 Skill 执行未结束");
            }
            return true;
        }
        return false;
    }

    @Override
    public void beforeModelCall(AgentCallbackContext ctx) {
        if (!(ctx.getInputs() instanceof ModelCallInputs input)) {
            return;
        }
        if (input.getTools() != null) {
            input.setTools(input.getTools().stream().filter(tool -> allowed.contains(com.moaagent.compat.CoreApi.toolName(tool))).toList());
        }
        if (ctx.getSession() != null) {
            AgentSessionApi api = ctx.getSession();
            Map<String, Object> exchange = IntentHandoff.projection(Json.object(
                    com.moaagent.compat.CoreApi.env(api, IntentHandoff.LOCAL_SKILL_EXCHANGE_ENV)));
            String query = SkillSession.load(ctx.getSession()).map(SkillSession::getQuery).orElse("");
            contributor.contribute(input, new ModelContextContributor.Context(
                    ctx.getSession(), query, exchange));
        }
    }

    @Override
    public void beforeToolCall(AgentCallbackContext ctx) {
        if (Boolean.TRUE.equals(ctx.getExtra().get("_skip_tool"))) {
            return;
        }
        if (ctx.getInputs() instanceof ToolCallInputs input && !allowed.contains(input.getToolName())) {
            throw new IllegalArgumentException("Skill Agent 拒绝未授权工具");
        }
    }

    @Override
    public void afterModelCall(AgentCallbackContext ctx) {
        if (!(ctx.getInputs() instanceof ModelCallInputs input) || !(input.getResponse() instanceof
                AssistantMessage message)) {
            return;
        }
        boolean hasToolCalls = message.getToolCalls() != null && !message.getToolCalls().isEmpty();
        String finalText = message.getContent() == null ? "" : String.valueOf(message.getContent());
        message.setReasoningContent("");
        message.setContent("");
        if (!hasToolCalls) {
            SkillSession state = SkillSession.load(ctx.getSession())
                    .orElseThrow(() -> new IllegalStateException("Skill 执行未初始化"));
            if (!requiresVerifiedCompletion && canCompleteFromModel(state)) {
                completeFromModel(ctx, state, finalText);
            }
            if ("ACTIVE".equals(state.getState())) {
                state.setState("FAILED");
                state.setOutcome(Map.of("protocol", "native_skill_v1", "success", false, "status", "failed",
                        "error", "MODEL_ENDED_WITHOUT_VERIFIED_RESULT"));
                state.save(ctx.getSession());
            }
            finish(ctx, state.getOutcome());
        }
    }

    private static boolean canCompleteFromModel(SkillSession state) {
        return "ACTIVE".equals(state.getState())
                && state.getPending().isEmpty() && state.getApprovals().isEmpty();
    }

    private static void completeFromModel(AgentCallbackContext ctx, SkillSession state, String finalText) {
        var receipts = SkillCompletion.receipts(state);
        if (finalText.isBlank() && receipts.isEmpty()) {
            return;
        }
        state.setState("COMPLETED");
        state.setOutcome(SkillCompletion.outcome(receipts, finalText));
        state.save(ctx.getSession());
    }

    /**
     * 保存 Skill 最终结果并停止后续模型执行。
     *
     * @param ctx 轨道回调上下文
     * @param output 待投影的输出内容
     */
    public static void finish(AgentCallbackContext ctx, Map<String, Object> output) {
        ctx.requestForceFinish(Map.of("result_type", "answer", "output",
                SkillOutput.naturalText(output).orElseGet(() -> Json.write(output))));
    }
}
