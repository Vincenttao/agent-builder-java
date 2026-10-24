/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.support;

import com.openjiuwen.core.session.AgentSessionApi;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 只读访问 runtime 提供的本次请求快照，不缓存、不回写 Session 或恢复输入。
 *
 * @since 0.1.0
 */
public final class RequestContextAccessor {
    private static final String REQUEST_CONTEXT = "runtime.request_context";

    private RequestContextAccessor() {
    }

    /**
     * 获取最新用户原文；无 user 消息时沿用运行时取最后一条消息的约定。
     * 此方法只提取文本，不判断是否发生意图切换。
     *
     * @param session 当前运行时会话
     * @return 当前请求的用户原文；没有可读取文本时返回空字符串
     */
    public static String latestUserQuery(Object session) {
        Object rawMessages = snapshot(session).get("messages");
        if (!(rawMessages instanceof List<?> messages)) {
            return "";
        }
        for (int index = messages.size() - 1; index >= 0; index--) {
            if (messages.get(index) instanceof Map<?, ?> message
                    && "user".equalsIgnoreCase(String.valueOf(message.get("role")))
                    && message.get("content") != null) {
                return String.valueOf(message.get("content"));
            }
        }
        if (!messages.isEmpty() && messages.get(messages.size() - 1) instanceof Map<?, ?> last
                && last.get("content") != null) {
            return String.valueOf(last.get("content"));
        }
        return "";
    }

    /**
     * 返回独立的 metadata 视图，排除运行时保留字段并规范化字符串 body。
     * 调用方仍须按操作声明选择字段，不能将整份 metadata 传入模型或脚本。
     *
     * @param session 当前运行时会话
     * @return 当前请求的只读元数据视图；不支持的会话返回空映射
     */
    public static Map<String, Object> metadata(Object session) {
        Map<String, Object> metadata = new LinkedHashMap<>(Json.object(snapshot(session).get("metadata")));
        metadata.keySet().removeIf(key -> key.startsWith("runtime."));
        if (metadata.get("body") instanceof String body) {
            metadata.put("body", Json.object(body));
        }
        return Collections.unmodifiableMap(metadata);
    }

    private static Map<String, Object> snapshot(Object session) {
        // 每次读取当前调用的环境，避免同一会话后续请求复用旧原文或旧凭据。
        return session instanceof AgentSessionApi api ? Json.object(com.moaagent.compat.CoreApi.env(api, REQUEST_CONTEXT)) : Map.of();
    }
}
