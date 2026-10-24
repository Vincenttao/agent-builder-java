/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.continuation.IntentSwitch;
import com.moaagent.agent.continuation.IntentSwitchTool;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.foundation.llm.schema.ToolMessage;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.AgentRail;
import com.openjiuwen.core.singleagent.rail.ToolCallInputs;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Ends the current Skill execution; routing remains the parent MOA's responsibility.
 *
 * @since 0.1.0
 */
public final class SkillIntentSwitchRail extends AgentRail {
    private static final String ANSWER_KEY = "__moa_skill_switch_answer__";

    public SkillIntentSwitchRail() {
        setPriority(1900);
    }

    @Override
    public void beforeToolCall(AgentCallbackContext ctx) {
        if (!(ctx.getInputs() instanceof ToolCallInputs inputs)) {
            return;
        }
        if (java.util.Set.of("confirm_action", "cancel_skill", "call_mcp", "call_versatile")
                .contains(inputs.getToolName())) {
            ctx.getSession().updateState(Map.of(ANSWER_KEY, "{}"));
        }
        if (!IntentSwitchTool.NAME.equals(inputs.getToolName())) {
            return;
        }
        String query = IntentSwitchTool.userQuery(ctx.getSession());
        SkillSession state = SkillSession.load(ctx.getSession()).orElseThrow();
        Map<String, Object> answer = Json.object(ctx.getSession().getState(ANSWER_KEY));
        Map<String, Object> outcome;
        if (query.isBlank()) {
            outcome = Map.of("error", "运行时缺少用户原话，不能切换意图。");
        } else if (!query.equals(answer.get("query")) || !state.getExecutionId().equals(answer.get("execution"))) {
            outcome = Map.of("error", "仅支持在 ask_user 应答中提出意图切换；确认与候选选择按确定性输入处理。");
        } else {
            outcome = suspend(ctx, IntentSwitchTool.signal(query, 0));
            SkillBoundaryRail.finish(ctx, outcome);
        }
        ctx.getExtra().put("_skip_tool", true);
        inputs.setToolResult(Json.write(outcome));
        inputs.setToolMsg(ToolMessage.builder().content(Json.write(outcome))
                .toolCallId(com.moaagent.compat.CoreApi.toolCallId(inputs.getToolCall())).build());
    }

    @Override
    public void afterToolCall(AgentCallbackContext ctx) {
        if (ctx.getInputs() instanceof ToolCallInputs inputs && "ask_user".equals(inputs.getToolName())) {
            SkillSession state = SkillSession.load(ctx.getSession()).orElseThrow();
            ctx.getSession().updateState(Map.of(ANSWER_KEY, Json.write(Map.of("execution", state.getExecutionId(),
                    "query", IntentSwitchTool.userQuery(ctx.getSession())))));
        }
    }

    static Map<String, Object> suspend(AgentCallbackContext ctx, Object response) {
        SkillSession state = SkillSession.load(ctx.getSession()).orElseThrow();
        if (!"ACTIVE".equals(state.getState())) {
            throw new IllegalStateException("Skill 执行不处于活动状态");
        }
        Map<String, Object> signal = new LinkedHashMap<>(IntentSwitch.payload(response));
        String query = IntentSwitchTool.userQuery(ctx.getSession());
        if (!query.isBlank() && !query.equals(state.getQuery())) {
            signal.put("user_query", query);
        }
        state.setState("SUSPENDED");
        state.getPending().clear();
        state.getApprovals().clear();
        state.setResponseMetadata(Map.of());
        Map<String, Object> outcome = Map.of("protocol", "native_skill_v1", "success", false,
                "status", "suspended", "result", signal);
        state.setOutcome(outcome);
        state.save(ctx.getSession());
        return outcome;
    }
}
