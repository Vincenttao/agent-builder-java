/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.support.Json;

import java.util.LinkedHashSet;
import java.util.Map;

/**
 * 根据输入契约生成可读的 Skill 执行确认内容。
 *
 * @since 0.1.0
 */
final class SkillConfirmation {
    private SkillConfirmation() { }

    static String render(SkillOperation operation, Map<String, Object> arguments) {
        StringBuilder message = new StringBuilder("确认执行：").append(singleLine(operation.title()));
        Map<String, Object> properties = SkillSchema.object(operation.modelInputSchema().get("properties"));
        var names = new LinkedHashSet<>(properties.keySet());
        names.addAll(arguments.keySet());
        for (String name : names) {
            if (arguments.containsKey(name)) {
                Map<String, Object> schema = SkillSchema.object(properties.getOrDefault(name, Map.of()));
                message.append("\n- ").append(singleLine(label(name, schema))).append("：")
                        .append(value(arguments.get(name)));
            }
        }
        return message.toString();
    }

    private static String label(String name, Map<String, Object> schema) {
        for (String key : java.util.List.of("title", "description")) {
            if (schema.get(key) instanceof String text && !text.isBlank()) {
                return text;
            }
        }
        return name;
    }

    private static String value(Object value) {
        return value instanceof String text ? singleLine(text) : Json.write(value);
    }

    private static String singleLine(String text) {
        String encoded = Json.write(text);
        return encoded.substring(1, encoded.length() - 1);
    }
}
