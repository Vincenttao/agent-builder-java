/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.interaction.FrontendEventType;
import com.openjiuwen.core.singleagent.interrupt.InterruptRequest;
import com.openjiuwen.core.singleagent.interrupt.ToolInterruptException;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.AgentRail;

import java.util.Map;

/**
 * 将 Skill 的用户输入中断转换为前端交互事件。
 *
 * @since 0.1.0
 */
final class SkillInteractionRail extends AgentRail {
    private final SkillEvents events;

    SkillInteractionRail(SkillEvents events) {
        this.events = events;
    }

    @Override
    public void onToolException(AgentCallbackContext ctx) {
        Throwable failure = ctx.getException();
        while (failure != null && !(failure instanceof ToolInterruptException)) {
            failure = failure.getCause();
        }
        if (failure instanceof ToolInterruptException interrupt) {
            InterruptRequest request = interrupt.getRequest();
            events.emit(ctx, FrontendEventType.INTERRUPT_START, Map.of("content", request.getMessage(),
                    "questions", request.getExtraFields().getOrDefault("questions", java.util.List.of()), "interrupt_id", interrupt.getToolCall().map(c -> c.getId()).orElse("")));
        }
    }
}
