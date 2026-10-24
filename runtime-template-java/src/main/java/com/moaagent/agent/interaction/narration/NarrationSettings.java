/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction.narration;

import java.time.Duration;

/**
 * 播放资源上限，与业务文案内容独立。
 *
 * @param enabled 是否启用进度话术模式
 * @param maxRequests 最大并发播放请求数
 * @param requestLifetime 单次请求播放资源最长存活时间，超时仅停止话术
 * @since 0.1.0
 */
public record NarrationSettings(boolean enabled, int maxRequests, Duration requestLifetime) {
    public NarrationSettings {
        if (maxRequests < 1 || requestLifetime == null || requestLifetime.toMillis() < 1) {
            throw new IllegalArgumentException("进度话术资源配置不合法");
        }
    }
}
