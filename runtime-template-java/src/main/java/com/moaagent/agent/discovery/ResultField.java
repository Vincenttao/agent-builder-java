/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.discovery;

import com.fasterxml.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.util.Map;

/**
 * 定义任务结果字段的提取路径、类型、单位和校验条件。
 *
 * @since 0.1.0
 */
public record ResultField(String path, Type type, String unit, Map<String, Object> checks) {
    /**
     * 表示业务结果字段支持的数据类型。
     *
     * @since 0.1.0
     */
    public enum Type {
        DECIMAL,
        STRING,
        BOOLEAN
    }

    public ResultField {
        validatePath(path);
        if (type == null) {
            throw new IllegalArgumentException("结果字段缺少 type");
        }
        unit = unit == null ? "" : unit;
        checks = checks == null ? Map.of() : Map.copyOf(checks);
        checks.forEach((pointer, expected) -> {
            validatePath(pointer);
            if (!(expected instanceof String || expected instanceof Boolean || expected instanceof Number)) {
                throw new IllegalArgumentException("结果校验值必须为标量");
            }
        });
    }

    /**
     * 按声明路径及校验条件提取结构化业务结果。
     *
     * @param root 已解析的业务结果根对象
     * @return 按声明路径及校验条件提取结构化业务结果
     */
    public Object read(JsonNode root) {
        for (Map.Entry<String, Object> check : checks.entrySet()) {
            JsonNode actual = locate(root, check.getKey());
            Object expected = check.getValue();
            boolean matches = expected instanceof String text ? actual.isTextual() && text.equals(actual.textValue())
                    : expected instanceof Boolean flag ? actual.isBoolean() && flag == actual.booleanValue()
                    : actual.isNumber() && decimal(expected.toString()).compareTo(actual.decimalValue()) == 0;
            if (!matches) {
                throw new IllegalArgumentException("RESULT_CHECK_FAILED");
            }
        }
        JsonNode value = locate(root, path);
        return switch (type) {
            case DECIMAL -> {
                if (!value.isNumber() && !value.isTextual()) {
                    throw new IllegalArgumentException("RESULT_TYPE_MISMATCH");
                }
                yield decimal(value.asText());
            }
            case STRING -> {
                if (!value.isTextual()) {
                    throw new IllegalArgumentException("RESULT_TYPE_MISMATCH");
                }
                yield value.textValue();
            }
            case BOOLEAN -> {
                if (!value.isBoolean()) {
                    throw new IllegalArgumentException("RESULT_TYPE_MISMATCH");
                }
                yield value.booleanValue();
            }
        };
    }

    /**
     * 将受支持的数值转换为精确十进制数，拒绝不合法的数值。
     *
     * @param text 待处理的文本内容
     * @return 将受支持的数值转换为精确十进制数，拒绝不合法的数值
     */
    public static BigDecimal decimal(String text) {
        if (text == null || text.length() > 128 || !text.matches("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?")) {
            throw new IllegalArgumentException("INVALID_DECIMAL");
        }
        BigDecimal value = new BigDecimal(text);
        if (Math.abs((long) value.scale()) > 128) {
            throw new IllegalArgumentException("INVALID_DECIMAL");
        }
        return value;
    }

    private static void validatePath(String path) {
        if (path == null || !path.startsWith("/") || path.length() > 512
                || path.matches(".*~(?![01]).*")) {
            throw new IllegalArgumentException("结果路径必须为 JSON Pointer，可用 * 穿过唯一数组元素");
        }
    }

    private static JsonNode locate(JsonNode root, String path) {
        JsonNode current = root;
        for (String segment : path.substring(1).split("/", -1)) {
            String token = segment.replace("~1", "/").replace("~0", "~");
            if (current != null && current.isArray()) {
                if (!"*".equals(token) || current.size() != 1) {
                    throw new IllegalArgumentException("RESULT_NOT_UNIQUE");
                }
                current = current.get(0);
            } else {
                current = current != null && current.isObject() ? current.get(token) : null;
            }
            if (current == null || current.isNull()) {
                throw new IllegalArgumentException("RESULT_FIELD_MISSING");
            }
        }
        return current;
    }
}
