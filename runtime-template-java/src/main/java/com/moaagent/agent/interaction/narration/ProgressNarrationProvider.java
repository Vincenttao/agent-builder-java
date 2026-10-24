/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction.narration;

import java.util.Optional;

/**
 * 业务进度话术 SPI。实现从本地资源或已刷新的配置缓存选择文案，不执行远端调用或启动线程。
 * 不提供方案时保持静默；不得返回模型推理、敏感凭据或尚未验证的完成结论。
 *
 * @since 0.1.0
 */
@FunctionalInterface
public interface ProgressNarrationProvider {
    /**
     * 选择并固定本次操作的播放方案；运行中配置更新只影响后续操作。
     *
     * @param context 脱敏的执行上下文
     * @return 可选播放方案，无匹配时返回 empty
     */
    Optional<NarrationPlan> resolve(NarrationContext context);
}
