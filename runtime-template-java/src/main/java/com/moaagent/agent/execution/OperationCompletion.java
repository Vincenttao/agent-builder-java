/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.execution;

import com.moaagent.agent.support.Json;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Terminal outcome of one operation invocation, not completion of its enclosing Skill, task or conversation.
 * Identity associates the invocation with its local execution and plan node; operation describes its origin.
 * Result contains the terminal status, processed output and runtime receipt.
 * Answer exposes the direct A2A payload or public Skill summary/receipt, never private Skill output.
 * Metadata is an immutable request snapshot. No writable Session is exposed.
 */
public record OperationCompletion(Identity identity, Operation operation, Result result, Map<String, Object> metadata) {
    /**
     * 业务操作的执行来源。
     */
    public enum Source {
        SKILL_SCRIPT, SKILL_A2A, DIRECT_A2A
    }
    /**
     * 业务操作完成时的执行状态。
     */
    public enum ExecutionStatus {
        SUCCEEDED, FAILED, CANCELLED
    }

    public OperationCompletion {
        Objects.requireNonNull(identity, "identity");
        Objects.requireNonNull(operation, "operation");
        Objects.requireNonNull(result, "result");
        metadata = snapshot(metadata);
    }

    /**
     * 返回用于完成通知去重的事件标识。
     *
     * @return 由操作调用标识派生的完成事件去重标识
     */
    public String eventId() {
        return identity.invocationId() + ":operation:completed";
    }

    /**
     * 返回本次业务操作的实际应答。
     *
     * @return 远端委派原始输出，或本地 Skill 的公开摘要及回执
     */
    public Object answer() {
        return operation.source() == Source.DIRECT_A2A
                ? result.output() : result.receipt().getOrDefault("summary", result.receipt());
    }

    public record Identity(String executionId, String invocationId, String parentInvocationId, String todoId) {
        public Identity {
            if (executionId == null || executionId.isBlank() || invocationId == null || invocationId.isBlank()
                    || todoId == null || todoId.isBlank()) {
                throw new IllegalArgumentException("Missing execution identity");
            }
        }
    }

    public record Operation(String name, Source source) {
        public Operation {
            if (name == null || name.isBlank()) {
                throw new IllegalArgumentException("Missing operation name");
            }
            Objects.requireNonNull(source, "source");
        }
    }

    public record Result(ExecutionStatus status, Object output, Map<String, Object> receipt) {
        public Result {
            Objects.requireNonNull(status, "status");
            output = freeze(Json.MAPPER.convertValue(output, Object.class));
            receipt = snapshot(receipt);
        }
    }

    private static Map<String, Object> snapshot(Map<String, Object> source) {
        Map<String, Object> copy = new LinkedHashMap<>();
        source.forEach((key, value) -> copy.put(key, freeze(Json.MAPPER.convertValue(value, Object.class))));
        return Collections.unmodifiableMap(copy);
    }

    private static Object freeze(Object value) {
        if (value instanceof Map<?, ?> source) {
            Map<Object, Object> copy = new LinkedHashMap<>();
            source.forEach((key, item) -> copy.put(key, freeze(item)));
            return Collections.unmodifiableMap(copy);
        }
        if (value instanceof List<?> source) {
            return source.stream().map(OperationCompletion::freeze).toList();
        }
        return value;
    }
}
