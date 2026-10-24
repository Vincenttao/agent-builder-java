/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.routing.context;

import com.moaagent.agent.support.Json;

import java.util.Map;

/**
 * 解包 MOA 请求层的轻量 query/intent JSON 外壳。
 *
 * <p>供首次路由和用户中断应答共用，不用于下游业务结果，也不递归解包。</p>
 *
 * @since 0.1.0
 */
public final class RequestEnvelope {
    private RequestEnvelope() {
    }

    /**
     * 提取字符串 query；无有效 query 时保留原始文本，结构化输入返回空字符串。
     *
     * @param value 原始文本或结构化请求
     * @return 请求 query
     */
    public static String query(Object value) {
        if (fields(value).get("query") instanceof String query) {
            return query;
        }
        return value instanceof String text ? text : "";
    }

    /**
     * 提取请求的显式 intent；不存在或类型不匹配时返回空字符串。
     *
     * @param value 原始文本或结构化请求
     * @return 显式 intent
     */
    public static String intent(Object value) {
        return fields(value).get("intent") instanceof String intent ? intent : "";
    }

    private static Map<?, ?> fields(Object value) {
        if (value instanceof Map<?, ?> map) {
            return map;
        }
        return value instanceof String text ? Json.object(text) : Map.of();
    }
}
