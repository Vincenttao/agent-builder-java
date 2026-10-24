/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.support;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.function.Supplier;

/**
 * 同步执行业务扩展并将运行时失败转换为明确的调用异常，不拦截 Error。
 *
 * @since 0.1.0
 */
public final class BusinessInvocation {
    private BusinessInvocation() { }

    /**
     * 在调用线程执行扩展，保留原始异常供调用方决定记录、隔离或重新抛出。
     *
     * @param action 待执行的业务扩展
     * @param <T> 扩展返回类型
     * @return 扩展的原始返回值
     */
    public static <T> T call(Supplier<T> action) {
        FutureTask<T> invocation = new FutureTask<>(action::get);
        invocation.run();
        try {
            return invocation.get();
        } catch (ExecutionException exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof Error error) {
                throw error;
            }
            if (cause instanceof RuntimeException failure) {
                throw new Failure(failure);
            }
            throw new IllegalStateException("Unexpected checked exception from business extension", cause);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Business invocation interrupted", exception);
        }
    }

    /**
     * 在调用线程执行无返回值的业务扩展。
     *
     * @param action 待执行的业务扩展
     */
    public static void run(Runnable action) {
        call(() -> {
            action.run();
            return Boolean.TRUE;
        });
    }

    /**
     * 业务扩展调用失败，保留原始运行时异常实例。
     *
     * @since 0.1.0
     */
    public static final class Failure extends RuntimeException {
        private static final long serialVersionUID = 1L;

        private final RuntimeException original;

        private Failure(RuntimeException original) {
            super(original);
            this.original = original;
        }

        /**
         * 返回扩展抛出的原始异常，便于保持业务错误传播语义。
         *
         * @return 原始运行时异常
         */
        public RuntimeException original() {
            return original;
        }
    }
}
