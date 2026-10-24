/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.routing.context.DefaultModelContextContributor;
import com.moaagent.agent.routing.context.ModelContextContributor;
import com.moaagent.agent.execution.OperationCompletionListener;
import com.moaagent.agent.rail.MoaAgentRailProvider;
import com.moaagent.agent.rail.MoaAgentRails;
import com.moaagent.agent.interaction.narration.NarrationOutput;
import com.moaagent.agent.interaction.narration.ProgressNarrationCoordinator;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.singleagent.schema.AgentCard;
import com.openjiuwen.harness.deep_agent.DeepAgent;
import com.openjiuwen.harness.factory.HarnessFactory;
import com.openjiuwen.harness.rails.skills.SkillUseRail;
import com.openjiuwen.harness.rails.interrupt.AskUserRail;
import com.openjiuwen.harness.tools.AskUserTool;
import com.openjiuwen.harness.schema.config.DeepAgentConfig;
import com.openjiuwen.harness.workspace.Workspace;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 装配基于 DeepAgent 的 Skill 执行实例及其工具和处理轨道。
 *
 * @since 0.1.0
 */
public final class NativeSkillAgent {
    private NativeSkillAgent() { }

    /**
     * 装配隔离的本地 DeepAgent、工具白名单和 Skill 执行轨道。
     *
     * @param settings 执行身份、工作目录及轮次配置
     * @param model 用于 Skill 执行的模型实例
     * @param assets 已校验的 Skill 资产
     * @param operations 部署授权的操作定义
     * @param scripts 沙箱脚本执行接口
     * @return 装配隔离的本地 DeepAgent、工具白名单和 Skill 执行轨道
     */
    public static DeepAgent create(Settings settings, Model model, SkillAssets assets,
            Map<String, SkillOperation> operations, SkillScriptRunner scripts) {
        return create(settings, model, assets, operations, new ExecutionServices(scripts));
    }

    /**
     * 创建带业务结果监听器的隔离 Skill 智能体。
     *
     * @param settings 本地实例运行配置
     * @param model 执行模型
     * @param assets 已校验的 Skill 资产
     * @param operations 部署授权的操作定义
     * @param services 脚本执行与业务结果通知服务
     * @return 装配工具白名单和执行轨道的本地 DeepAgent
     */
    public static DeepAgent create(Settings settings, Model model, SkillAssets assets,
            Map<String, SkillOperation> operations, ExecutionServices services) {
        String systemPrompt = settings.systemPrompt();
        com.moaagent.agent.support.PromptTemplates.requireText(systemPrompt);
        List<Object> tools = new ArrayList<>(SkillTools.create(operations));
        tools.add(new AskUserTool("cn", null));
        tools.add(com.moaagent.agent.continuation.IntentSwitchTool.create());
        var disclosure = new SkillUseRail(List.of(assets.root()), "all", List.of(), List.of(), List.of(), true, false);
        var events = new SkillEvents(services.output());
        var narration = new SkillNarration(services.progress(), services.output(), operations);
        var rails = MoaAgentRails.assemble(MoaAgentRailProvider.Role.SKILL,
                List.of(new SkillBoundaryRail(operations, services.contextContributor()),
                        new SkillIntentSwitchRail(),
                        new SkillNarrationRail(narration),
                        new SkillActionRail(assets, operations, services.scripts(),
                                narration, events, services.completionListeners()), disclosure,
                        new AskUserRail(), new SkillInteractionRail(events)), services.railProviders());
        var config = DeepAgentConfig.builder().systemPrompt(prompt(assets, operations, systemPrompt))
                .model(model).tools(tools)
                .rails(new ArrayList<>(rails))
                .maxIterations(settings.iterations()).maxParallelToolCalls(1)
                .enableTaskLoop(true).enableTaskPlanning(false).addGeneralPurposeAgent(false)
                .restrictToWorkDir(true).workspacePath(settings.workspace()).language("zh-CN").build();
        return HarnessFactory.createDeepAgent(AgentCard.builder().id(settings.id()).name(settings.id())
                .description("原生 Skill 执行智能体").build(), config,
                Workspace.builder().rootPath(settings.workspace()).language("zh-CN").build());
    }

    private static String prompt(SkillAssets assets, Map<String, SkillOperation> operations, String systemPrompt) {
        Map<String, Object> contracts = new LinkedHashMap<>();
        operations.entrySet().stream().filter(entry -> !entry.getValue().internal()).forEach(entry -> {
            String name = entry.getKey();
            SkillOperation operation = entry.getValue();
            // 执行器与后台完整契约不属于模型职责，只展示业务入口及精简公开投影。
            contracts.put(name, Map.of("title", operation.title(), "tool",
                operation.type() == SkillOperation.Type.A2A ? "call_versatile" : "call_mcp",
                "input", SkillSchema.publicContract(operation.modelInputSchema()),
                "summary", SkillSchema.publicContract(operation.summarySchema()),
                "confirmation_required", operation.confirmationRequired(), "terminal", operation.terminal()));
        });
        return systemPrompt.stripTrailing() + "\n本次部署工具契约：\n" + Json.write(contracts)
                + "\n入口 Skill：\n" + assets.entry();
    }

    /**
     * Skill 执行依赖的宿主服务，不携带业务资产或部署配置。
     *
     * @param scripts 沙箱脚本执行服务
     * @param progress 统一进度播放服务
     * @param output 本次调用的展示事件输出端，不改变业务结果或中断恢复协议
     * @since 0.1.0
     */
    public record ExecutionServices(SkillScriptRunner scripts,
            ProgressNarrationCoordinator progress, NarrationOutput output,
            java.util.List<OperationCompletionListener> completionListeners,
            ModelContextContributor contextContributor,
            List<MoaAgentRailProvider> railProviders) {
        public ExecutionServices {
            completionListeners = java.util.List.copyOf(completionListeners);
            java.util.Objects.requireNonNull(contextContributor);
            railProviders = List.copyOf(railProviders);
        }

        public ExecutionServices(SkillScriptRunner scripts, ProgressNarrationCoordinator progress,
                NarrationOutput output,
                java.util.List<OperationCompletionListener> completionListeners,
                ModelContextContributor contextContributor) {
            this(scripts, progress, output, completionListeners, contextContributor, List.of());
        }

        public ExecutionServices(SkillScriptRunner scripts, ProgressNarrationCoordinator progress,
                NarrationOutput output,
                java.util.List<OperationCompletionListener> completionListeners) {
            this(scripts, progress, output, completionListeners,
                    new DefaultModelContextContributor());
        }

        public ExecutionServices(SkillScriptRunner scripts,
                ProgressNarrationCoordinator progress, NarrationOutput output) {
            this(scripts, progress, output, java.util.List.of());
        }
        public ExecutionServices(SkillScriptRunner scripts,
                ProgressNarrationCoordinator progress) {
            this(scripts, progress, NarrationOutput.sessionStream());
        }

        public ExecutionServices(SkillScriptRunner scripts) {
            this(scripts, ProgressNarrationCoordinator.disabled());
        }
    }

    /**
     * 本地 Skill 实例的运行配置，不包含业务资产或授权信息。
     *
     * @param id 执行实例的唯一智能体标识
     * @param workspace 隔离工作目录
     * @param iterations 允许的最大执行轮次
     * @param systemPrompt 当前部署使用的 Skill 提示词
     * @since 0.1.0
     */
    public record Settings(String id, String workspace, int iterations, String systemPrompt) {
        public Settings(String id, String workspace, int iterations) {
            this(id, workspace, iterations,
                    com.moaagent.agent.support.PromptTemplates.defaultPrompt("native-skill"));
        }
    }
}
