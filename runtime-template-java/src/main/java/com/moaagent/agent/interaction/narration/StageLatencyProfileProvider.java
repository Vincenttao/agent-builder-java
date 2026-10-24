/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction.narration;

import java.util.Optional;

/**
 * 阶段时延画像 SPI，与业务文案 SPI 独立。按阶段或安全属性选择本地快照；
 * 不得在 resolve 中等待远端服务。业务可用后台刷新的跑批/监控结果替换配置实现。
 *
 * @since 0.1.0
 */
@FunctionalInterface
public interface StageLatencyProfileProvider {
    /**
     * 选择本次阶段的时延画像。
     *
     * @param context 不含原始 query、应答和凭据的只读操作上下文
     * @return 整个阶段的时延快照，无画像时使用保守的本地播放节奏
     */
    Optional<StageLatencyProfile> resolve(NarrationContext context);
}