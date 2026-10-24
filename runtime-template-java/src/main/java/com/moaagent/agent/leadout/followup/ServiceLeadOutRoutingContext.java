/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.leadout.followup;

import com.moaagent.agent.routing.context.IntentHandoff;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.session.AgentSessionApi;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 管理当前请求携带的服务带出路由上下文。
 *
 * @since 0.1.0
 */
public final class ServiceLeadOutRoutingContext {
    private static final String STATE_KEY = "__moa_service_lead_out_route__";

    private ServiceLeadOutRoutingContext() { }

    /**
     * 将服务带出上下文保存为当前会话快照。
     *
     * @param session 当前请求所属会话
     * @param query 本次用户输入原文
     * @param snapshot 待保存或消费的服务带出快照
     */
    public static void save(AgentSessionApi session, String query, Map<String, Object> snapshot) {
        Map<String, Object> context = new LinkedHashMap<>(IntentHandoff.projection(snapshot));
        context.put("reply", IntentHandoff.reply(context, query));
        session.updateState(Map.of(STATE_KEY, Json.write(IntentHandoff.projection(context))));
    }

    /**
     * 读取当前请求对应的上下文快照。
     *
     * @param session 当前请求所属会话
     * @return 当前上下文快照；没有记录时返回空映射
     */
    public static Map<String, Object> current(AgentSessionApi session) {
        return session == null ? Map.of() : IntentHandoff.projection(Json.object(session.getState(STATE_KEY)));
    }

    /**
     * 清除当前会话中的服务带出状态。
     *
     * @param session 当前请求所属会话
     */
    public static void clear(AgentSessionApi session) {
        session.updateState(Map.of(STATE_KEY, ""));
    }
}
