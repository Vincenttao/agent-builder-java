/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 校验 Skill 输入输出的结构、类型及业务配置声明的字段约束。
 *
 * @since 0.1.0
 */
public final class SkillSchema {
    private static final Set<String> KEYS = Set.of("type", "properties", "required", "additionalProperties",
            "items", "enum", "minimum", "maximum", "minLength", "maxLength", "maxItems", "description", "title");

    private SkillSchema() { }

    /**
     * 仅投影模型决策需要的结构和业务边界；不是运行时校验契约。
     * 长度、数量及对象封闭性仍由完整 schema 强制校验。
     *
     * @param schema 完整的输入或输出契约
     * @return 供模型使用的契约投影
     */
    public static Map<String, Object> publicContract(Map<String, Object> schema) {
        Map<String, Object> projected = new java.util.LinkedHashMap<>();
        for (String key : List.of("type", "description", "enum", "minimum", "maximum")) {
            if (schema.containsKey(key)) {
                projected.put(key, schema.get(key));
            }
        }
        if ("object".equals(schema.get("type"))) {
            Map<String, Object> properties = new java.util.LinkedHashMap<>();
            object(schema.get("properties")).forEach((name, value) ->
                    properties.put(name, publicContract(object(value))));
            if (!properties.isEmpty()) {
                projected.put("properties", properties);
            }
            if (schema.get("required") instanceof List<?> required && !required.isEmpty()) {
                projected.put("required", required);
            }
        }
        if ("array".equals(schema.get("type"))) {
            projected.put("items", publicContract(object(schema.get("items"))));
        }
        return projected;
    }

    /**
     * 规范并校验工具输入输出模式。
     *
     * @param schema 待应用的结构化模式
     * @return 规范并校验工具输入输出模式
     */
    public static Map<String, Object> normalize(Map<String, Object> schema) {
        if (schema == null) {
            throw new IllegalArgumentException("Skill schema 不可为空");
        }
        var normalized = new java.util.LinkedHashMap<>(schema);
        if ("object".equals(schema.get("type"))) {
            Map<String, Object> properties = new java.util.LinkedHashMap<>();
            object(schema.getOrDefault("properties", Map.of()))
                    .forEach((name, value) -> properties.put(name, normalize(object(value))));
            normalized.put("properties", properties);
            Object required = schema.getOrDefault("required", List.of());
            normalized.put("required", sequence(required));
        }
        if ("array".equals(schema.get("type"))) {
            normalized.put("items", normalize(object(schema.get("items"))));
        }
        if (schema.containsKey("enum")) {
            normalized.put("enum", sequence(schema.get("enum")));
        }
        definition(normalized);
        return normalized;
    }

    private static List<?> sequence(Object value) {
        if ("".equals(value)) {
            return List.of();
        }
        if (value instanceof List<?> list) {
            return List.copyOf(list);
        }
        if (value instanceof Map<?, ?> indexed && indexed.size() <= 256) {
            var list = new java.util.ArrayList<>();
            for (int index = 0; index < indexed.size(); index++) {
                if (!indexed.containsKey(String.valueOf(index))) {
                    throw new IllegalArgumentException("Skill schema 列表索引无效");
                }
                list.add(indexed.get(String.valueOf(index)));
            }
            return List.copyOf(list);
        }
        throw new IllegalArgumentException("Skill schema 要求列表");
    }

    /**
     * 返回可用于工具定义的参数模式。
     *
     * @param schema 待应用的结构化模式
     */
    public static void definition(Map<String, Object> schema) {
        if (schema == null || !KEYS.containsAll(schema.keySet())
                || !Set.of("object", "array", "string", "number", "integer", "boolean").contains(String
                        .valueOf(schema.get("type")))) {
            throw new IllegalArgumentException("skill schema 类型或约束不受支持");
        }
        if ("object".equals(schema.get("type"))) {
            Map<String, Object> properties = object(schema.get("properties"));
            if (!Boolean.FALSE.equals(schema.get("additionalProperties")) || !(schema.get("required") instanceof
                    List<?> required)
                    || !properties.keySet().containsAll(required)) {
                throw new IllegalArgumentException("skill 对象 schema 必须显式限制字段");
            }
            properties.values().forEach(value -> definition(object(value)));
        }
        if ("array".equals(schema.get("type"))) {
            definition(object(schema.get("items")));
        }
    }

    /**
     * 递归验证结构化值是否满足授权模式。
     *
     * @param schema 待应用的结构化模式
     * @param value 待转换或校验的值
     */
    public static void validate(Map<String, Object> schema, Object value) {
        if (!KEYS.containsAll(schema.keySet())) {
            throw new IllegalArgumentException("不支持的 skill schema 约束");
        }
        String type = String.valueOf(schema.get("type"));
        boolean valid = validType(type, value);
        if (!valid || schema.get("enum") instanceof List<?> choices && !choices.contains(value)) {
            throw new IllegalArgumentException("skill 数据不符合类型或枚举契约");
        }
        if (value instanceof Map<?, ?> fields) {
            validateFields(schema, fields);
            return;
        }
        if (value instanceof List<?> items) {
            if (items.size() > integer(schema, "maxItems", 128)) {
                throw new IllegalArgumentException("skill 数组超限");
            }
            items.forEach(item -> validate(object(schema.get("items")), item));
            return;
        }
        if (value instanceof String text) {
            if (text.length() < integer(schema, "minLength", 0) || text.length() > integer(schema, "maxLength", 8192)) {
                throw new IllegalArgumentException("skill 文本长度不符合契约");
            }
            return;
        }
        if (value instanceof Number number) {
            BigDecimal decimal = new BigDecimal(number.toString());
            if (schema.containsKey("minimum") && decimal.compareTo(new BigDecimal(schema.get("minimum").toString())) < 0
                    || schema.containsKey("maximum") && decimal.compareTo(new BigDecimal(schema.get("maximum")
                            .toString())) > 0) {
                throw new IllegalArgumentException("skill 数值超出契约范围");
            }
        }
    }

    private static boolean validType(String type, Object value) {
        return switch (type) {
            case "object" -> value instanceof Map<?, ?>;
            case "array" -> value instanceof List<?>;
            case "string" -> value instanceof String;
            case "number" -> value instanceof Number;
            case "integer" -> value instanceof Number number && new BigDecimal(number.toString())
                    .stripTrailingZeros().scale() <= 0;
            case "boolean" -> value instanceof Boolean;
            default -> false;
        };
    }

    private static void validateFields(Map<String, Object> schema, Map<?, ?> fields) {
        Map<String, Object> properties = object(schema.getOrDefault("properties", Map.of()));
        if (!(schema.get("required") instanceof List<?> required) || !fields.keySet().containsAll(required)
                || !Boolean.FALSE.equals(schema.get("additionalProperties")) || !properties.keySet()
                        .containsAll(fields.keySet())) {
            throw new IllegalArgumentException("skill 对象字段契约不匹配");
        }
        fields.forEach((key, field) -> validate(object(properties.get(key)), field));
    }

    /**
     * 校验对象及其字符串键，返回用于后续模式校验的映射。
     *
     * @param value 待校验的结构化值
     * @return 已验证键类型的对象
     * @throws IllegalArgumentException 值不是对象或键不是字符串时抛出
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> object(Object value) {
        if (!(value instanceof Map<?, ?> map) || map.keySet().stream().anyMatch(key -> !(key instanceof String))) {
            throw new IllegalArgumentException("skill 数据必须是对象");
        }
        return (Map<String, Object>) map;
    }

    private static int integer(Map<String, Object> schema, String key, int fallback) {
        return schema.get(key) instanceof Number number ? number.intValue() : fallback;
    }
}
