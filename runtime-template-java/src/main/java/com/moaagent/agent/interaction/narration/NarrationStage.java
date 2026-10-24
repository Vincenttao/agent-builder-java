/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction.narration;

/**
 * 可公开的执行阶段，不描述模型内部推理或预判业务结果。
 *
 * @since 0.1.0
 */
public enum NarrationStage {
    ROUTING_ANALYSIS, ROUTING_ARBITRATION, MODEL_MAIN, MODEL_SKILL, CONDITION_EVALUATE,
    SCRIPT_BEFORE, SCRIPT_RESULT, CAPABILITY_DISCOVERY, TASK_BINDING, TASK_DISPATCH, TASK_RESUME, SKILL_PROGRESS,
    SERVICE_LEAD_OUT
}
