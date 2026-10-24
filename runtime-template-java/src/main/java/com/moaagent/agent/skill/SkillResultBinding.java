/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.fasterxml.jackson.core.JsonPointer;

public record SkillResultBinding(String operation, String path) {
    public SkillResultBinding {
        if (operation == null || !operation.matches("[A-Za-z][A-Za-z0-9_-]{0,63}") || path == null) {
            throw new IllegalArgumentException("结果绑定缺少来源操作或 JSON Pointer");
        }
        JsonPointer.compile(path);
    }
}
