/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.execution;

/**
 * Observes the terminal outcome of one operation invocation, not its enclosing Skill, task or conversation.
 * The context is valid only during the synchronous callback. Consumers interpret domain outcomes and
 * deduplicate durable writes by eventId. Notifications are best effort, not a transactional outbox.
 * Observer failures do not change the execution result or retry the underlying operation.
 *
 * @since 0.1.0
 */
@FunctionalInterface
public interface OperationCompletionListener {
    /**
     * 接收操作完成快照，并在当前会话上下文中执行后续业务处理。
     *
     * @param completion 已完成操作的结果与执行身份快照
     * @param context 操作完成时的会话与用户查询上下文
     */
    void onCompleted(OperationCompletion completion, OperationCompletionContext context);
}
