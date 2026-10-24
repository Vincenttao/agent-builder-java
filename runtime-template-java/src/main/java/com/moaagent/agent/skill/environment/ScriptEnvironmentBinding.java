/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill.environment;

import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * 描述脚本环境变量对应的配置引用及必填约束，不存储实际凭据。
 *
 * @since 0.1.0
 */
public record ScriptEnvironmentBinding(String ref, @DefaultValue("true") boolean required) {
    public ScriptEnvironmentBinding {
        if (ref == null || !ref.matches("[A-Za-z0-9][A-Za-z0-9_.-]{0,255}")) {
            throw new IllegalArgumentException("脚本环境变量必须引用有效配置键，不能填写值或占位表达式");
        }
    }
}
