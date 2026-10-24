/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.interaction.narration.NarrationOutput;
import com.moaagent.agent.interaction.narration.NarrationStage;
import com.moaagent.agent.interaction.narration.ProgressNarrationCoordinator;
import com.openjiuwen.core.session.AgentSessionApi;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

/**
 * Skill 展示边界。进度可以跨内部读资料／模型轮次持续，但不会跨 L2 或用户交互中断。
 * 只管理展示，不修改业务状态、不推测执行路径、不接管 L2 的输出。
 *
 * @since 0.1.0
 */
final class SkillNarration {
    private static final Logger LOG = LoggerFactory.getLogger(SkillNarration.class);

    private final ProgressNarrationCoordinator progress;
    private final NarrationOutput output;
    private final Map<String, SkillOperation> operations;

    SkillNarration(ProgressNarrationCoordinator progress, NarrationOutput output,
            Map<String, SkillOperation> operations) {
        this.progress = progress;
        this.output = SkillNarrationOutput.wrap(output);
        this.operations = Map.copyOf(operations);
    }

    void begin(AgentSessionApi session) {
        progress.beginRequest(session, output);
        // 恢复时先处理原工具回调，不能把已结束／待确认的请求当成新业务开始。
        SkillSession.load(session).filter(state -> "ACTIVE".equals(state.getState())
                && state.getPending().isEmpty() && session.getState(
                        com.openjiuwen.core.singleagent.interrupt.InterruptConstants.INTERRUPTION_KEY) == null)
                .ifPresent(state -> model(session));
    }

    void model(AgentSessionApi session) {
        if (!progress.enabled()) {
            return;
        }
        if (SkillNarrationContext.awaitingTerminalConfirmation(session, operations)) {
            return;
        }
        present(session, () -> SkillNarrationContext.model(session, operations));
    }

    void operation(AgentSessionApi session, String name, SkillOperation operation) {
        if (progress.enabled()) {
            present(session, () -> SkillNarrationContext.operation(session, name, operation));
        }
    }

    private void present(AgentSessionApi session, java.util.function.Supplier<Map<String, String>> context) {
        try {
            // 终结／取消后的框架收尾不应再次播报“继续办理”。
            if (SkillSession.load(session).filter(state -> "ACTIVE".equals(state.getState())).isEmpty()) {
                return;
            }
            progress.startOnce(session, NarrationStage.SKILL_PROGRESS, context.get());
        } catch (IllegalArgumentException | IllegalStateException exception) {
            unavailable(exception);
        } catch (RuntimeException exception) {
            unavailable(exception);
        }
    }

    private static void unavailable(RuntimeException exception) {
        LOG.warn("[SKILL-NARRATION] action=unavailable errorType={}", exception.getClass().getSimpleName());
    }

    void stop(AgentSessionApi session, String reason) {
        progress.stop(session, reason);
    }

    void end(AgentSessionApi session, String reason) {
        progress.endRequest(session, reason);
    }
}