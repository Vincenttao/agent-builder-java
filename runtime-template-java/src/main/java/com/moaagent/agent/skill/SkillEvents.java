/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.interaction.narration.NarrationOutput;
import com.moaagent.agent.interaction.FrontendEventType;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

/**
 * 发射 Skill 任务生命周期事件；仅携带任务渲染所需的显式负载。
 *
 * @since 0.1.0
 */
final class SkillEvents {
    private static final Logger LOG = LoggerFactory.getLogger(SkillEvents.class);

    private final NarrationOutput output;

    SkillEvents() {
        this(NarrationOutput.sessionStream());
    }

    SkillEvents(NarrationOutput output) {
        this.output = java.util.Objects.requireNonNull(output);
    }

    void step(AgentCallbackContext ctx, SkillSession state, String call, SkillOperation operation, String
            status) {
        Map<String, Object> data = Map.of("id", state.getExecutionId() + ":" + call, "parent_id", state.getParentId(),
                "scope_id", state.getExecutionId(), "content", operation.title(), "status", status,
                "risk", operation.confirmationRequired() ? "HIGH" : "LOW", "mode", "append",
                "event_id", state.getExecutionId() + ":" + call + ":" + status);
        if ("RUNNING".equals(status)) {
            emit(ctx, FrontendEventType.TODOLIST_START, Map.of("data", Map.of("scope_id", state.getExecutionId(),
                    "mode", "append")));
            emit(ctx, FrontendEventType.TODOLIST_ITEM, Map.of("data", data));
            emit(ctx, FrontendEventType.TODOLIST_END, Map.of("data", Map.of("scope_id", state.getExecutionId(),
                    "mode", "append")));
        }
        emit(ctx, "RUNNING".equals(status) ? FrontendEventType.TODO_START : FrontendEventType.TODO_END, Map
                .of("data", data));
    }

    void emit(AgentCallbackContext ctx, FrontendEventType event, Map<String, Object> data) {
        var payload = new java.util.LinkedHashMap<>(data);
        var state = SkillSession.load(ctx.getSession());
        // 与进度共用本次调用的输出端，避免业务结果仍滞留在子流、下一阶段提示却已直达父流。
        try {
            output.emit(ctx.getSession(), event, payload);
        } catch (IllegalArgumentException | IllegalStateException exception) {
            LOG.warn("[SKILL-EVENT] event={} action=unavailable errorType={}", event,
                    exception.getClass().getSimpleName());
        } catch (RuntimeException exception) {
            // 展示失败不能撤销已执行的业务，也不能触发业务重试。
            LOG.warn("[SKILL-EVENT] event={} action=unavailable errorType={}", event,
                    exception.getClass().getSimpleName());
        }
    }
}
