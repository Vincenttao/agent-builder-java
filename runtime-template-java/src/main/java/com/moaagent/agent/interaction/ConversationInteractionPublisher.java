/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction;

import com.moaagent.agent.support.BusinessInvocation;
import com.moaagent.agent.support.Json;
import com.moaagent.agent.support.RequestContextAccessor;
import com.openjiuwen.core.session.AgentSessionApi;
import com.openjiuwen.core.singleagent.rail.InvokeInputs;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * 在 MOA 业务流程中发布输入与对外语义输出，不依赖协议报文。
 *
 * @since 0.1.0
 */
public final class ConversationInteractionPublisher {
    private static final Logger LOGGER = LoggerFactory.getLogger(ConversationInteractionPublisher.class);

    private final Supplier<List<ConversationInteractionListener>> listeners;

    public ConversationInteractionPublisher(Supplier<List<ConversationInteractionListener>> listeners) {
        this.listeners = listeners;
    }

    /**
     * 在路由前建立输入轮次；远端执行回调复用已有轮次，不重复记录用户输入。
     *
     * @param session 当前请求会话
     * @param inputs 本次调用输入
     * @param agentId 宿主智能体标识
     */
    public void begin(AgentSessionApi session, InvokeInputs inputs, String agentId) {
        observe(() -> beginTurn(session, inputs, agentId));
    }

    private void beginTurn(AgentSessionApi session, InvokeInputs inputs, String agentId) {
        synchronized (session) {
            Object rawRequest = com.moaagent.compat.CoreApi.env(session, "runtime.request_context");
            Object invocation = rawRequest;
            if (invocation == null) {
                invocation = inputs;
            }
            if (ConversationInteractionContext.matches(session, invocation)) {
                return;
            }
            Map<String, Object> request = Json.object(rawRequest);
            Map<String, Object> transport = Json.object(request.get("metadata"));
            boolean isContinuation = transport.get("runtime.remoteToolResults") instanceof Map<?, ?>
                    && transport.get("runtime.remoteBatchId") instanceof String batchId && !batchId.isBlank();
            Map<String, Object> previous = Map.of();
            if (isContinuation) {
                previous = Json.object(session.getState(ConversationInteractionContext.TURN_KEY));
            }
            Map<String, Object> identity = identity(session, inputs, request, agentId);
            if (!identity.equals(previous.get("identity"))) {
                previous = Map.of();
            }
            String requestId = String.valueOf(previous.getOrDefault("requestId", UUID.randomUUID().toString()));
            long sequence = previous.get("nextSequence") instanceof Number number ? number.longValue() : 0;
            Map<String, Object> metadata = inputMetadata(session, request);
            Object input = input(session, inputs, metadata);
            var turn = new ConversationInteractionContext.Turn(identity, requestId, sequence);
            var context = new ConversationInteractionContext(this, session, turn,
                    invocation, metadata);
            context.bind();
            if (!isContinuation) {
                context.input(input);
            }
        }
    }

    private static Map<String, Object> inputMetadata(AgentSessionApi session, Map<String, Object> request) {
        Map<String, Object> metadata = new LinkedHashMap<>(RequestContextAccessor.metadata(session));
        if (request.get("messages") instanceof List<?> messages) {
            for (int index = messages.size() - 1; index >= 0; index--) {
                Map<String, Object> message = Json.object(messages.get(index));
                if ("user".equalsIgnoreCase(String.valueOf(message.get("role")))) {
                    metadata.put("messageMetadata", Json.object(message.get("metadata")));
                    break;
                }
            }
        }
        return metadata;
    }

    private static Map<String, Object> identity(AgentSessionApi session, InvokeInputs inputs,
            Map<String, Object> request, String agentId) {
        Map<String, Object> metadata = RequestContextAccessor.metadata(session);
        Map<String, Object> body = Json.object(metadata.get("body"));
        return Map.of("agentId", value(String.valueOf(session.getEnvs().getOrDefault("agent_id", agentId)), agentId),
                "conversationId", value(request.get("conversationId"),
                        value(inputs.getConversationId(), session.getSessionId())),
                "tenantId", value(request.get("tenantId"), value(body.get("tenant_id"), "")),
                "userId", value(request.get("userId"), value(body.get("user_id"), "")));
    }

    private static Object input(AgentSessionApi session, InvokeInputs inputs, Map<String, Object> metadata) {
        if (inputs.getQuery() instanceof com.openjiuwen.core.session.interaction.InteractiveInput interactive) {
            metadata.put("interaction", Json.object(interactive));
        }
        String text = RequestContextAccessor.latestUserQuery(session);
        if (!text.isBlank()) {
            return text;
        }
        if (inputs.getQuery() != null && !String.valueOf(inputs.getQuery()).isBlank()) {
            return inputs.getQuery();
        }
        return Json.object(inputs.getQuery());
    }

    private static String value(Object value, String fallback) {
        return value instanceof String text && !text.isBlank() ? text : fallback;
    }

    void publish(Supplier<ConversationInteraction> interaction) {
        observe(() -> notifyListeners(interaction.get()));
    }

    void observe(Runnable action) {
        try {
            BusinessInvocation.run(action);
        } catch (BusinessInvocation.Failure exception) {
            LOGGER.warn("Cannot publish conversation interaction", exception.original());
        }
    }

    private void notifyListeners(ConversationInteraction interaction) {
        for (ConversationInteractionListener listener : listeners.get()) {
            try {
                BusinessInvocation.run(() -> listener.onInteraction(interaction));
            } catch (BusinessInvocation.Failure exception) {
                LOGGER.warn("ConversationInteractionListener failed: {}", listener.getClass().getName(),
                        exception.original());
            }
        }
    }
}
