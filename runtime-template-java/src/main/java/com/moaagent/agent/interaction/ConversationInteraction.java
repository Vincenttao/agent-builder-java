/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction;

import com.moaagent.agent.support.MetadataSnapshot;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

public record ConversationInteraction(Identity identity, Direction direction, String event,
        Object content, Map<String, Object> metadata, Instant occurredAt) {
    public ConversationInteraction {
        Objects.requireNonNull(identity, "identity");
        Objects.requireNonNull(direction, "direction");
        Objects.requireNonNull(event, "event");
        Objects.requireNonNull(occurredAt, "occurredAt");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("content", content);
        payload.put("metadata", metadata == null ? Map.of() : metadata);
        Map<String, Object> snapshot = MetadataSnapshot.copy(payload, Integer.MAX_VALUE);
        content = snapshot.get("content");
        metadata = com.moaagent.agent.support.Json.object(snapshot.get("metadata"));
        metadata = MetadataSnapshot.copy(metadata, Integer.MAX_VALUE);
    }

    /**
     * 人机交互消息的传递方向。
     */
    public enum Direction {
        USER_TO_AGENT, AGENT_TO_USER
    }

    /**
     * 读取与客户端封装无关的结构化语义输出。
     *
     * @return 语义输出快照；未记录有效语义事件时为空
     */
    public java.util.Optional<OutputEvent> semanticOutput() {
        Map<String, Object> payload = com.moaagent.agent.support.Json.object(metadata.get(OutputEvent.METADATA_KEY));
        return payload.get("event") instanceof String type && !type.isBlank()
                ? java.util.Optional.of(OutputEvent.fromPayload(payload)) : java.util.Optional.empty();
    }

    public record Identity(String agentId, String conversationId, String tenantId, String userId,
            String requestId, String messageId, long sequence) { }
}
