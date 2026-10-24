/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction.narration;

import java.time.Duration;

/**
 * 跑批或监控得到的阶段等待画像，不代表业务超时，也不控制模型解码。
 *
 * @param expectedDuration 预计整个阶段的等待时间，黑盒模型包含 prefix 与完整 decode
 * @param continuationAfter 仍未完成时允许启动第二句话的时点，相对阶段开始
 * @since 0.1.0
 */
public record StageLatencyProfile(Duration expectedDuration, Duration continuationAfter) {
    public StageLatencyProfile {
        if (expectedDuration == null || expectedDuration.toMillis() < 1
                || expectedDuration.compareTo(Duration.ofMinutes(10)) > 0
                || continuationAfter == null || continuationAfter.compareTo(expectedDuration) < 0
                || continuationAfter.compareTo(Duration.ofMinutes(10)) > 0) {
            throw new IllegalArgumentException("阶段时延画像必须为正数，续接阈值不得早于预期完成时间且不得超过10分钟");
        }
    }

    /**
     * 使用黑盒模型的 prefix、逐 token decode 与预计输出量估算总等待。
     *
     * @param prefix 模型首 token 前等待
     * @param perToken 后续每 token 等待
     * @param outputTokens 预计输出 token 数，包含首 token
     * @param continuationAfter 长尾等待提示阈值
     * @return 一次调用使用的固定画像快照
     */
    public static StageLatencyProfile model(Duration prefix, Duration perToken, int outputTokens,
            Duration continuationAfter) {
        if (prefix == null || prefix.isNegative() || perToken == null || perToken.isNegative()
                || outputTokens < 1 || outputTokens > 100000) {
            throw new IllegalArgumentException("模型时延画像参数不合法");
        }
        return new StageLatencyProfile(prefix.plus(perToken.multipliedBy(outputTokens - 1L)), continuationAfter);
    }
}
