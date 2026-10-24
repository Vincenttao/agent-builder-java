/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction;

/**
 * 监听 Agent 与客户端之间包含元数据的交互。
 * 由 MOA 输入与业务输出点发布，内容不依赖前端协议封装。
 *
 * @since 0.1.0
 */
@FunctionalInterface
public interface ConversationInteractionListener {
    /**
     * 接收包含元数据的人机交互快照。
     *
     * @param interaction 包含请求身份、交互内容及元数据的不可变快照
     */
    void onInteraction(ConversationInteraction interaction);
}
