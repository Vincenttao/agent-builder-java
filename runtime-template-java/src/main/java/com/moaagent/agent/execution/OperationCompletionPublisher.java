/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.execution;

import com.moaagent.agent.support.BusinessInvocation;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;
import java.util.function.Supplier;

/**
 * Isolates notification construction and each consumer from the execution path.
 *
 * @since 0.1.0
 */
public final class OperationCompletionPublisher {
    private static final Logger LOG = LoggerFactory.getLogger(OperationCompletionPublisher.class);

    private final List<OperationCompletionListener> listeners;

    public OperationCompletionPublisher(List<OperationCompletionListener> listeners) {
        this.listeners = List.copyOf(listeners);
    }

    /**
     * 构造完成通知并逐个发布，隔离快照构造与监听器失败。
     *
     * @param factory 完成通知快照的延迟构造函数
     * @param contextFactory 当前执行会话上下文的延迟构造函数
     */
    public void publish(Supplier<OperationCompletion> factory, Supplier<OperationCompletionContext> contextFactory) {
        if (listeners.isEmpty()) {
            return;
        }
        OperationCompletion completion;
        OperationCompletionContext context;
        try {
            completion = BusinessInvocation.call(factory);
            context = BusinessInvocation.call(contextFactory);
        } catch (BusinessInvocation.Failure exception) {
            LOG.warn("[MOA-COMPLETION] action=snapshot_failed errorType={}",
                    exception.original().getClass().getSimpleName());
            return;
        }
        for (OperationCompletionListener listener : listeners) {
            try {
                BusinessInvocation.run(() -> listener.onCompleted(completion, context));
            } catch (BusinessInvocation.Failure exception) {
                LOG.warn("[MOA-COMPLETION] action=completion_listener_failed errorType={}",
                        exception.original().getClass().getSimpleName());
            }
        }
    }
}
