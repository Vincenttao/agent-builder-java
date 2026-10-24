/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction;

import com.moaagent.agent.support.RequestContextAccessor;
import com.moaagent.agent.support.MetadataSnapshot;
import com.openjiuwen.core.session.AgentSessionApi;
import com.openjiuwen.core.session.AgentSessionApi;
import com.openjiuwen.service.adapters.agentcore.ext.context.ResponseMetadataAccessor;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 请求级交互关联；checkpoint 仅保存轮次身份与序号，不保存监听器或对话历史。
 *
 * @since 0.1.0
 */
public final class ConversationInteractionContext {
    /**
     * 会话环境中当前请求交互上下文的键。
     */
    public static final String ENV_KEY = "moa.interaction.context";

    /**
     * 交互元数据中用户输入轮次标识的键。
     */
    public static final String REQUEST_ID = "moa.interaction.requestId";

    /**
     * 交互元数据中智能体及会话身份信息的键。
     */
    public static final String IDENTITY = "moa.interaction.identity";
    static final String TURN_KEY = "moa_interaction_turn";

    private final ConversationInteractionPublisher publisher;
    private final AgentSessionApi session;
    private final Map<String, Object> identity;
    private final String requestId;
    private final Object rawRequest;
    private final Map<String, Object> inputMetadata;
    private long sequence;
    private Object lastAnswer;

    ConversationInteractionContext(ConversationInteractionPublisher publisher, AgentSessionApi session,
            Turn turn, Object rawRequest, Map<String, Object> inputMetadata) {
        this.publisher = publisher;
        this.session = session;
        this.identity = turn.identity();
        this.requestId = turn.requestId();
        this.sequence = turn.nextSequence();
        this.rawRequest = rawRequest;
        this.inputMetadata = MetadataSnapshot.copy(inputMetadata, Integer.MAX_VALUE);
    }

    /**
     * 读取当前轮次的关联元数据，供业务按会话列表查找上一轮交互。
     *
     * @param session 当前请求会话
     * @return 请求元数据及 MOA 的轮次身份
     */
    public static Map<String, Object> metadata(AgentSessionApi session) {
        Map<String, Object> metadata = new LinkedHashMap<>(RequestContextAccessor.metadata(session));
        current(session).ifPresent(context -> {
            metadata.put(REQUEST_ID, context.requestId);
            metadata.put(IDENTITY, context.identity);
        });
        return java.util.Collections.unmodifiableMap(metadata);
    }

    /**
     * 记录 MOA 业务出口产生的语义事件及其应答元数据。
     *
     * @param session 当前请求会话
     * @param output 未封装协议的输出事件
     * @param metadata 当前应答附带的元数据
     */
    public static void output(AgentSessionApi session, OutputEvent output, Map<String, Object> metadata) {
        if (output.is(FrontendEventType.THINK_CHUNK) || output.is(FrontendEventType.THINK_END)) {
            return;
        }
        current(session).ifPresent(context -> context.publisher.observe(() -> {
            context.emitOutput(output.semantic(), metadata);
            if (output.is(FrontendEventType.FINAL_ANSWER_CHUNK)) {
                context.lastAnswer = output.content();
            }
        }));
    }

    static void answer(AgentSessionApi session, Map<String, Object> result) {
        if (result == null || "interrupt".equals(result.get("result_type"))) {
            return;
        }
        Object answer = result.getOrDefault("answer", result.get("output"));
        if (answer == null) {
            return;
        }
        current(session).ifPresent(context -> context.publisher.observe(() -> {
            if (!java.util.Objects.equals(context.lastAnswer, answer)) {
                String event = "error".equals(result.get("result_type")) ? "error" : "answer";
                var output = new OutputEvent(event, Map.of("content", answer));
                context.emitOutput(output, Map.of());
                context.lastAnswer = output.content();
            }
        }));
    }

    static boolean matches(AgentSessionApi session, Object rawRequest) {
        return rawRequest != null && current(session).filter(context -> context.rawRequest == rawRequest).isPresent();
    }

    private static Optional<ConversationInteractionContext> current(AgentSessionApi session) {
        if (session != null
                && com.moaagent.compat.CoreApi.env(session, ENV_KEY) instanceof ConversationInteractionContext context
                && context.session == session) {
            return Optional.of(context);
        }
        return Optional.empty();
    }

    void bind() {
        com.moaagent.compat.CoreApi.putEnv(session, ENV_KEY, this);
        saveTurn();
    }

    void input(Object input) {
        emit(ConversationInteraction.Direction.USER_TO_AGENT, "input", input, inputMetadata, requestId);
    }

    private void emitOutput(OutputEvent output, Map<String, Object> responseMetadata) {
        Map<String, Object> metadata = new LinkedHashMap<>(inputMetadata);
        metadata.putAll(ResponseMetadataAccessor.snapshot(session));
        metadata.putAll(responseMetadata);
        metadata.put(OutputEvent.METADATA_KEY, output.payload());
        emit(ConversationInteraction.Direction.AGENT_TO_USER, output.type(), output.content(), metadata,
                UUID.randomUUID().toString());
    }

    private synchronized void emit(ConversationInteraction.Direction direction, String event, Object content,
            Map<String, Object> metadata, String messageId) {
        Map<String, Object> details = new LinkedHashMap<>(metadata);
        details.put(REQUEST_ID, requestId);
        details.put(IDENTITY, identity);
        var messageIdentity = new ConversationInteraction.Identity(identityValue("agentId"),
                identityValue("conversationId"), identityValue("tenantId"),
                identityValue("userId"), requestId, messageId, sequence++);
        saveTurn();
        publisher.publish(() -> new ConversationInteraction(messageIdentity, direction, event, content, details,
                Instant.now()));
    }

    private String identityValue(String key) {
        return identity.get(key) instanceof String value ? value : "";
    }

    private void saveTurn() {
        session.updateState(Map.of(TURN_KEY, Map.of("requestId", requestId, "identity", identity,
                "nextSequence", sequence)));
    }

    record Turn(Map<String, Object> identity, String requestId, long nextSequence) { }
}
