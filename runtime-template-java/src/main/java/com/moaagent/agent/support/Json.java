/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.support;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Map;

/**
 * 提供通用 JSON 序列化与对象解析工具。
 *
 * @since 0.1.0
 */
public final class Json {
    /**
     * 统一用于状态与协议序列化的 JSON 映射器。
     */
    public static final ObjectMapper MAPPER = new ObjectMapper();

    private Json() {
    }

    /**
     * 将值序列化为 JSON 文本，失败时报告无效输入。
     *
     * @param value 待转换或校验的值
     * @return 将值序列化为 JSON 文本，失败时报告无效输入
     */
    public static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("无法序列化 MOA 状态", exception);
        }
    }

    /**
     * 将 JSON 文本或对象转换为字符串键映射。
     *
     * @param value 待转换或校验的值
     * @return 将 JSON 文本或对象转换为字符串键映射
     */
    public static Map<String, Object> object(Object value) {
        try {
            Map<String, Object> parsed = MAPPER.readValue(value instanceof String text ? text : write(value), new
                    TypeReference<>() { });
            return parsed == null ? Map.of() : parsed;
        } catch (JsonProcessingException exception) {
            return Map.of();
        }
    }
}
