/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill.environment;

import java.util.Map;
import java.util.Set;

/**
 * 封装脚本操作和执行阶段，并校验本次授权环境变量的名称及数量。
 *
 * @since 0.1.0
 */
public record ScriptEnvironmentContext(String operation, Stage stage, Map<String, ScriptEnvironmentBinding> bindings) {
    /**
     * 区分操作前置脚本和结果处理脚本。
     *
     * @since 0.1.0
     */
    public enum Stage {
        BEFORE_SCRIPT,
        RESULT_SCRIPT
    }
    private static final Set<String> RESERVED = Set.of("SKILL_INPUT", "PATH", "HOME", "ENV", "BASH_ENV",
            "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS");

    public ScriptEnvironmentContext {
        if (operation == null || !operation.matches("[A-Za-z][A-Za-z0-9_-]{0,63}") || stage == null) {
            throw new IllegalArgumentException("脚本环境变量缺少有效操作与阶段");
        }
        bindings = checkedBindings(bindings);
    }

    private static boolean reservedPrefix(String name) {
        return name.startsWith("PYTHON") || name.startsWith("LD_") || name.startsWith("DYLD_");
    }

    static Map<String, ScriptEnvironmentBinding> checkedBindings(Map<String, ScriptEnvironmentBinding> bindings) {
        if (bindings == null) {
            return Map.of();
        }
        if (bindings.size() > 32) {
            throw new IllegalArgumentException("脚本环境变量绑定数量超限");
        }
        bindings.forEach((name, binding) -> {
            if (name == null || !name.matches("[A-Z][A-Z0-9_]{0,127}") || RESERVED.contains(name)
                    || reservedPrefix(name) || binding == null) {
                throw new IllegalArgumentException("脚本环境变量名称无效或覆盖运行环境保留项");
            }
        });
        return Map.copyOf(bindings);
    }
}
