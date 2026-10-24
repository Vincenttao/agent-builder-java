/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.support.Json;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 从嵌套执行输出中提取包含协议和成功标识的标准 Skill 结果。
 *
 * @since 0.1.0
 */
public final class SkillOutput {
    private SkillOutput() { }

    /**
     * 提取原生 Skill 协议终态；无有效协议结果时返回空映射。
     *
     * @param value 待转换或校验的值
     * @return 提取原生 Skill 协议终态；无有效协议结果时返回空映射
     */
    public static Map<String, Object> result(Object value) {
        return result(value, 0);
    }

    /**
     * 提取已自然完成的 Skill 原始文本，供对外回答使用；内部执行结果保持不变。
     *
     * @param value 运行时保存的 Skill 执行结果
     * @return 自然结束的原始文本；其他执行结果为空
     */
    public static Optional<String> naturalText(Object value) {
        Map<String, Object> outcome = result(value);
        return Boolean.TRUE.equals(outcome.get("success")) && "completed".equals(outcome.get("status"))
                && "natural_end".equals(outcome.get("completion_reason"))
                && outcome.get("output") instanceof String text ? Optional.of(text) : Optional.empty();
    }

    private static Map<String, Object> result(Object value, int depth) {
        if (value == null || depth > 12) {
            return Map.of();
        }
        Map<String, Object> fields = Json.object(value);
        if ("native_skill_v1".equals(fields.get("protocol")) && fields.get("success") instanceof Boolean) {
            return fields;
        }
        for (String key : List.of("final_result", "output", "result", "content", "payload", "data")) {
            Map<String, Object> found = result(fields.get(key), depth + 1);
            if (!found.isEmpty()) {
                return found;
            }
        }
        return Map.of();
    }
}
