/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction.narration;

import com.moaagent.agent.interaction.EventEmitters;
import com.moaagent.agent.interaction.FrontendEventType;
import com.openjiuwen.core.session.AgentSessionApi;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;

import java.util.Map;

/**
 * 本次调用绑定的展示事件输出端。协议封装由宿主负责，播放器不识别主／子 Agent。
 * 宿主可将业务展示事件送入同一输出端以保持顺序，不用它传递业务返回值或恢复凭据。
 * 不写入 checkpoint；实现不得把可变的“当前会话”保存在共享 Provider 中。
 *
 * @since 0.1.0
 */
@FunctionalInterface
public interface NarrationOutput {
    /**
     * 向当前请求的前端输出端发送一个展示事件。
     *
     * @param session 当前运行时会话
     * @param event 前端事件类型
     * @param payload 事件负载
     */
    void emit(AgentSessionApi session, FrontendEventType event, Map<String, Object> payload);

    /**
     * 创建使用会话默认输出流的展示适配器。
     *
     * @return 会话默认输出流适配器
     */
    static NarrationOutput sessionStream() {
        return (session, event, payload) -> EventEmitters.emit(
                AgentCallbackContext.builder().session(session).build(), event, payload);
    }
}
