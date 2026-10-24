/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill.environment;

import java.util.Map;

/**
 * 分别声明前置脚本和结果脚本可使用的环境变量绑定。
 *
 * @since 0.1.0
 */
public record ScriptEnvironmentBindings(Map<String, ScriptEnvironmentBinding> beforeScript,
        Map<String, ScriptEnvironmentBinding> resultScript) {
    public ScriptEnvironmentBindings {
        beforeScript = ScriptEnvironmentContext.checkedBindings(beforeScript);
        resultScript = ScriptEnvironmentContext.checkedBindings(resultScript);
    }

    /**
     * 根据操作和执行阶段构造环境变量绑定上下文。
     *
     * @param operation 部署授权的操作名称
     * @param stage 当前脚本执行阶段
     * @return 根据操作和执行阶段构造环境变量绑定上下文
     */
    public ScriptEnvironmentContext context(String operation, ScriptEnvironmentContext.Stage stage) {
        return new ScriptEnvironmentContext(operation, stage,
                stage == ScriptEnvironmentContext.Stage.BEFORE_SCRIPT ? beforeScript : resultScript);
    }
}
