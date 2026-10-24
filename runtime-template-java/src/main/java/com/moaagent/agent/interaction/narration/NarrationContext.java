/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction.narration;

import java.util.Map;

/**
 * 业务话术选择的只读上下文，不包含用户原文、凭据、模型提示词或业务应答。
 *
 * @param requestId 本次调用标识，不跨恢复请求复用
 * @param operationId 本次操作唯一标识
 * @param conversationId 运行时会话标识
 * @param stage 实际执行阶段
 * @param attributes 基座明确提供的阶段、任务标识及安全展示名称，不从模型参数任意展开
 * @since 0.1.0
 */
public record NarrationContext(String requestId, String operationId, String conversationId,
        NarrationStage stage, Map<String, String> attributes) {
    public NarrationContext {
        attributes = Map.copyOf(attributes);
    }
}