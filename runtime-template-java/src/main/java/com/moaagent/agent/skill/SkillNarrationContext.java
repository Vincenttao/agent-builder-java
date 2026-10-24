/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.openjiuwen.core.session.AgentSessionApi;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 从已校验的执行状态提取展示字段，不猜测下一动作，不暴露用户原文、结果或凭据。
 * 展示去重使用业务进展，不使用模型轮数、read_file 次数或脚本阶段。
 *
 * @since 0.1.0
 */
final class SkillNarrationContext {
    private SkillNarrationContext() { }

    static Map<String, String> model(AgentSessionApi session, Map<String, SkillOperation> operations) {
        SkillSession state = SkillSession.load(session).orElseThrow();
        Map<String, String> attributes = base(state);
        String last = state.getResultVersions().entrySet().stream()
                .max(Comparator.comparingInt(Map.Entry::getValue)).map(Map.Entry::getKey).orElse("");
        boolean preparing = state.getRevision() == 0 && state.getReceipts().isEmpty();
        attributes.put("action", preparing ? "prepare" : "continue");
        if (!last.isEmpty() && operations.containsKey(last)) {
            attributes.put("last_operation", last);
            attributes.put("last_operation_name", displayName(operations.get(last).title()));
        }
        return Map.copyOf(attributes);
    }

    static boolean awaitingTerminalConfirmation(AgentSessionApi session, Map<String, SkillOperation> operations) {
        SkillSession state = SkillSession.load(session).orElseThrow();
        String last = state.getResultVersions().entrySet().stream()
                .max(Comparator.comparingInt(Map.Entry::getValue)).map(Map.Entry::getKey).orElse("");
        SkillOperation operation = operations.get(last);
        return operation != null && operation.terminal()
                && state.getPending().isEmpty()
                && Integer.valueOf(state.getRevision()).equals(state.getResultVersions().get(last));
    }

    static Map<String, String> operation(AgentSessionApi session, String name, SkillOperation operation) {
        Map<String, String> attributes = base(SkillSession.load(session).orElseThrow());
        // 名称和标题来自部署授权，不允许模型自填展示字段。
        attributes.put("action", operation.type() == SkillOperation.Type.SCRIPT ? "operation" : "process_result");
        attributes.put("skill_operation", name);
        attributes.put("operation_display_name", displayName(operation.title()));
        return Map.copyOf(attributes);
    }

    private static Map<String, String> base(SkillSession state) {
        Map<String, String> attributes = new LinkedHashMap<>();
        attributes.put("agent_role", "skill");
        attributes.put("execution_id", state.getExecutionId());
        attributes.put("todo_id", state.getParentId());
        String taskDisplayName = displayName(state.getTaskDisplayName());
        if (!taskDisplayName.isBlank()) {
            attributes.put("task_display_name", taskDisplayName);
        }
        return attributes;
    }

    private static String displayName(String value) {
        if (value == null) {
            return "";
        }
        String text = value.replaceAll("[\\p{Cntrl}\\s]+", " ").strip();
        return text.codePointCount(0, text.length()) <= 48 ? text
                : text.substring(0, text.offsetByCodePoints(0, 48)) + "…";
    }
}
