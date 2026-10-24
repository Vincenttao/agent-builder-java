/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.openjiuwen.core.foundation.tool.ToolCard;
import com.openjiuwen.core.foundation.tool.function.LocalFunction;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 声明 Skill 智能体可调用的业务工具及参数结构。
 *
 * @since 0.1.0
 */
public final class SkillTools {
    /**
     * Skill 执行器允许暴露的工具名称集合。
     */
    public static final List<String> NAMES = List.of("read_file", "call_versatile", "call_mcp", "confirm_action",
            "skill_results", "cancel_skill");

    private SkillTools() { }

    /**
     * 依据部署授权生成 Skill 可调用工具列表。
     *
     * @param operations 部署授权的操作定义
     * @return 依据部署授权生成 Skill 可调用工具列表
     */
    public static List<Object> create(Map<String, SkillOperation> operations) {
        List<Object> tools = new ArrayList<>();
        tools.add(tool("read_file", "读取授权 Skill 目录中的说明文件，执行相关业务前先读取 SKILL.md",
                object(Map.of("file_path", text()), List.of("file_path"))));
        for (String name : List.of("call_versatile", "call_mcp", "confirm_action")) {
            var choices = operations.entrySet().stream().filter(entry -> !entry.getValue().internal())
                    .filter(entry -> "confirm_action".equals(name)
                    ? entry.getValue().confirmationRequired() : ("call_versatile".equals(name)
                    ? entry.getValue().type() == SkillOperation.Type.A2A : entry.getValue().type()
                            == SkillOperation.Type.SCRIPT))
                    .map(Map.Entry::getKey).sorted().toList();
            if (choices.isEmpty()) {
                continue;
            }
            tools.add(tool(name, "confirm_action".equals(name)
                    ? "对指定操作和精确参数发起用户确认；用户回答由运行时恢复，不得自行声称已确认"
                    : "执行部署授权的业务操作；arguments 必须符合系统提示中的对应输入契约",
                    object(Map.of("operation", Map.of("type", "string", "enum", choices),
                            "arguments", Map.of("type", "object")), List.of("operation", "arguments"))));
        }
        var visible = operations.entrySet().stream().filter(entry -> !entry.getValue().internal())
                .map(Map.Entry::getKey).sorted().toList();
        if (!visible.isEmpty()) {
            tools.add(tool("skill_results", "查询当前会话已保存的公开 operation 摘要或索引，不会触发新的业务调用",
                    object(Map.of("operation", Map.of("type", "string", "enum", visible)), List.of())));
        }
        tools.add(tool("cancel_skill", "请求取消当前组合任务，运行时会二次确认；不回滚已完成的业务", object(Map
                .of(), List.of())));
        return tools;
    }

    private static Object tool(String name, String description, Map<String, Object> schema) {
        return new LocalFunction(ToolCard.builder().name(name).description(description).inputParams(schema).build(),
                input -> {
            throw new IllegalStateException("Skill 工具必须经授权 Rail 执行");
        });
    }

    private static Map<String, Object> text() {
        return Map.of("type", "string", "maxLength", 8192);
    }
    private static Map<String, Object> object(Map<String, Object> properties, List<String> required) {
        return Map.of("type", "object", "properties", properties, "required", required, "additionalProperties", false);
    }
}
