/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.continuation;

import com.moaagent.agent.routing.context.RequestEnvelope;
import com.moaagent.agent.support.RequestContextAccessor;
import com.openjiuwen.core.foundation.tool.ToolCard;
import com.openjiuwen.core.foundation.tool.function.LocalFunction;
import com.openjiuwen.core.session.AgentSessionApi;

import java.util.Map;

/**
 * A model requests a switch; the runtime supplies the actual user text.
 *
 * @since 0.1.0
 */
public final class IntentSwitchTool {
    /**
     * Tool name exposed to the skill model.
     */
    public static final String NAME = "switch_intent";

    private IntentSwitchTool() { }

    /**
     * Creates the model-visible switch tool.
     *
     * @return switch tool definition
     */
    public static LocalFunction create() {
        return new LocalFunction(ToolCard.builder().name(NAME)
                .description("仅在 ask_user 应答中，依据业务 Skill 判断用户明确提出另一个业务目标时，挂起并重新路由。"
                        + "普通参数回答、确认、取消或含糊回答不能据此切换。原话由运行时读取。")
                .inputParams(Map.of("type", "object", "properties", Map.of(),
                        "additionalProperties", false)).build(), inputs -> {
                    throw new IllegalStateException("意图切换必须由运行时轨道处理");
                });
    }

    /**
     * Reads the current user query from the runtime context.
     *
     * @param session current session
     * @return current user query
     */
    public static String userQuery(AgentSessionApi session) {
        String raw = RequestContextAccessor.latestUserQuery(session);
        return RequestEnvelope.query(raw);
    }

    /**
     * Builds an intent-switch signal.
     *
     * @param query user query to route
     * @param hops switch count already observed by the caller
     * @return switch signal payload
     */
    public static Map<String, Object> signal(String query, int hops) {
        return Map.of("type", IntentSwitch.TYPE, "user_query", query, "moa_switch_hops", hops);
    }
}
