/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.support.Json;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 汇总执行轨道已校验并保存的公开操作回执，不重新决定是否必须调用业务操作。 */
final class SkillCompletion {
    private static final Set<String> RECEIPT_FIELDS = Set.of(
            "success", "operation", "version", "result_ref", "summary");

    private SkillCompletion() { }

    static List<Map<String, Object>> receipts(SkillSession state) {
        return state.getReceipts().values().stream()
                .map(saved -> Json.object(Json.object(saved).get("response")))
                .filter(receipt -> receipt.keySet().equals(RECEIPT_FIELDS)
                        && Boolean.TRUE.equals(receipt.get("success")))
                .sorted(Comparator.comparingInt(SkillCompletion::version))
                .map(receipt -> Json.object(Json.write(receipt)))
                .toList();
    }

    static Map<String, Object> outcome(List<Map<String, Object>> receipts, String finalText) {
        Map<String, Object> outcome = new LinkedHashMap<>(Map.of(
                "protocol", "native_skill_v1", "success", true, "status", "completed",
                "completion_reason", "natural_end", "output", finalText.isBlank()
                        ? publicReceipts(receipts) : finalText));
        if (!receipts.isEmpty()) {
            outcome.put("data", receipts.get(receipts.size() - 1));
            outcome.put("completed_operations", receipts);
        }
        return outcome;
    }

    private static String publicReceipts(List<Map<String, Object>> receipts) {
        var results = receipts.stream().map(receipt -> Map.of(
                "operation", receipt.get("operation"), "summary", receipt.get("summary"))).toList();
        return Json.write(Map.of("completed_operations", results));
    }

    private static int version(Map<String, Object> receipt) {
        if (receipt.get("version") instanceof Integer value) {
            return value;
        }
        throw new IllegalArgumentException("Skill 完成回执版本无效");
    }
}
