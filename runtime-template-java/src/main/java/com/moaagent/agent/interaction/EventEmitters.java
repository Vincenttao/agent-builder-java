/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction;

import com.openjiuwen.core.common.exception.BaseError;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;

/**
 * 统一发射结构化 OutputEvent，由 OutputEvent 封装内部 OutputSchema。
 * 调用方只填充当前事件需要对外展示的字段；不额外生成时间、会话或执行诊断字段。
 * 发射失败记 ERROR + 堆栈（关键事件丢失须可见），不中断 agent 主流程。
 *
 * @since 0.1.0
 */
public final class EventEmitters {
    private static final Logger LOGGER = LoggerFactory.getLogger(EventEmitters.class);

    private EventEmitters() {
    }

    /**
     * 发射一个前端事件到 session 流（custom 通道，下游 custom_rest 解包为 SSE data: 行）。
     * type 确定语义类型；payload 提供 content、data 和交互信息，对外协议在出口统一封装。
     *
     * @param ctx 当前会话的回调上下文
     * @param type 前端事件类型
     * @param payload 不含保留字段的事件负载
     */
    public static void emit(AgentCallbackContext ctx, FrontendEventType type, Map<String, Object> payload) {
        try {
            emit(ctx, OutputEvent.of(type, payload));
        } catch (BaseError | IllegalStateException e) {
            LOGGER.error("[MOA-EVENT] emit '{}' failed: {}", type.wireName(), e.getMessage(), e);
        }
    }

    /**
     * 将结构化输出事件写入当前会话的前端输出流。
     *
     * @param ctx 当前 Agent 回调上下文
     * @param event 待发送或记录的事件
     */
    public static void emit(AgentCallbackContext ctx, OutputEvent event) {
        emit(ctx, event, event.type());
    }

    /**
     * 将结构化输出事件写入当前会话的前端输出流。
     *
     * @param ctx 当前 Agent 回调上下文
     * @param event 待发送或记录的事件
     * @param eventName 对外输出使用的事件名称
     */
    public static void emit(AgentCallbackContext ctx, OutputEvent event, String eventName) {
        emit(ctx, event, eventName, Map.of());
    }

    /**
     * 记录业务应答元数据并发射输出事件；元数据不添加到前端负载中。
     *
     * @param ctx 当前 Agent 回调上下文
     * @param event 待发送的语义事件
     * @param eventName 对外事件名称
     * @param metadata 仅供交互记录保存的应答元数据
     */
    public static void emit(AgentCallbackContext ctx, OutputEvent event, String eventName,
            Map<String, Object> metadata) {
        try {
            synchronized (ctx.getSession()) {
                ConversationInteractionContext.output(ctx.getSession(), event, metadata);
                ctx.getSession().writeStream(event.toOutputSchema(0, eventName));
            }
        } catch (BaseError | IllegalStateException e) {
            LOGGER.error("[MOA-EVENT] emit '{}' failed: {}", event.type(), e.getMessage(), e);
        }
    }

    /**
     * 会话键（.todo 存储同键）；session 不可用时不抛出。
     *
     * @param ctx 当前回调上下文
     * @return 当前会话标识，不可用时为 unknown
     */
    public static String sessionId(AgentCallbackContext ctx) {
        try {
            return ctx.getSession().getSessionId();
        } catch (IllegalStateException | NullPointerException e) {
            return "unknown";
        }
    }
}
