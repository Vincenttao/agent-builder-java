/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.routing.context;

import com.moaagent.agent.discovery.CandidateCard;
import com.moaagent.agent.discovery.HandoffSpec;
import com.moaagent.agent.leadout.followup.ServiceLeadOutRoutingContext;
import com.moaagent.agent.support.Json;
import com.moaagent.agent.support.RequestContextAccessor;
import com.openjiuwen.core.session.AgentSessionApi;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

public record IntentHandoff(HandoffSpec.Mode mode, String query, String targetIntent,
        List<String> candidateCapabilityIds, Map<String, Object> serviceLeadOut) {
    private static final String INVALIDATED_KEY = "__moa_intent_handoff_invalidated__";

    /**
     * Invalidates the current handoff context.
     *
     * @param session current session
     */
    public static void invalidate(AgentSessionApi session) {
        session.updateState(Map.of(INVALIDATED_KEY, true));
        clear(session);
    }

    /**
     * Starts a new request and enables incoming handoff processing.
     *
     * @param session current session
     */
    public static void beginRequest(AgentSessionApi session) {
        session.updateState(Map.of(INVALIDATED_KEY, false));
    }

    /**
     * METADATA_KEY
     */
    public static final String METADATA_KEY = "moa.intent_handoff";

    /**
     * LOCAL_SKILL_EXCHANGE_ENV
     */
    public static final String LOCAL_SKILL_EXCHANGE_ENV = "moa.local_skill_lead_out_exchange";

    public IntentHandoff {
        if (mode == null || query == null || query.isBlank() || query.length() > 16384) {
            throw new IllegalArgumentException("交接缺少模式或当前原话");
        }
        targetIntent = targetIntent == null ? "" : targetIntent;
        candidateCapabilityIds = new HandoffSpec(mode, candidateCapabilityIds).candidateCapabilityIds();
        if (mode == HandoffSpec.Mode.TARGET ? targetIntent.isBlank() : !targetIntent.isBlank()) {
            throw new IllegalArgumentException("明确目标与待识别交接不得混用");
        }
        serviceLeadOut = projection(serviceLeadOut);
    }

    /**
     * incoming
     *
     * @param session session
     * @param query query
     * @return Optional<IntentHandoff>
     */
    public static Optional<IntentHandoff> incoming(AgentSessionApi session, String query) {
        if (Boolean.TRUE.equals(session.getState(INVALIDATED_KEY))) {
            return Optional.empty();
        }
        Object raw = RequestContextAccessor.metadata(session).get(METADATA_KEY);
        if (raw == null) {
            return Optional.empty();
        }
        IntentHandoff handoff = Json.MAPPER.convertValue(raw, IntentHandoff.class);
        if (handoff == null) {
            throw new IllegalArgumentException("交接上下文无效");
        }
        return handoff.query().equals(query) ? Optional.of(handoff) : Optional.empty();
    }

    /**
     * outgoing
     *
     * @param card card
     * @param query query
     * @param leadOut leadOut
     * @return IntentHandoff
     */
    public static IntentHandoff outgoing(CandidateCard card, String query, Map<String, Object> leadOut) {
        return new IntentHandoff(card.handoff().mode(), query,
                card.handoff().mode() == HandoffSpec.Mode.TARGET ? card.intent() : "",
                card.handoff().candidateCapabilityIds(), leadOut);
    }

    /**
     * scope
     *
     * @param catalog catalog
     * @return List<CandidateCard>
     */
    public List<CandidateCard> scope(List<CandidateCard> catalog) {
        if (candidateCapabilityIds.isEmpty()) {
            return List.copyOf(catalog);
        }
        List<CandidateCard> scoped = catalog.stream().filter(card -> candidateCapabilityIds.contains(card
                .id())).toList();
        if (scoped.size() != candidateCapabilityIds.size()) {
            throw new IllegalArgumentException("交接候选不在当前 Agent 目录中");
        }
        return scoped;
    }

    /**
     * context
     *
     * @return Map<String,Object>
     */
    public Map<String, Object> context() {
        return Map.of("mode", mode.name(), "query", query, "targetIntent", targetIntent,
                "candidateCapabilityIds", candidateCapabilityIds, "serviceLeadOut", serviceLeadOut);
    }

    /**
     * recognitionInput
     *
     * @param session session
     * @param query query
     * @return String
     */
    public static String recognitionInput(AgentSessionApi session, String query) {
        Map<String, Object> leadOut = visibleLeadOut(session, query);
        if (leadOut.isEmpty()) {
            return query;
        }
        String reply = reply(leadOut, query);
        return "[本轮服务带出承接，仅供意图识别，不是执行授权]\nASSISTANT ("
                + leadOut.getOrDefault("sourceAgent", "上层 Agent") + "): " + displayed(leadOut)
                + "\nUSER: " + reply + (reply.equals(query) ? "" : "\n当前委派任务: " + query)
                + "\n[结构化交接]\n" + incoming(session, query).map(IntentHandoff::context)
                        .map(Json::write).orElseGet(() -> Json.write(leadOut));
    }

    /**
     * visibleLeadOut
     *
     * @param session session
     * @param query query
     * @return Map<String,Object>
     */
    public static Map<String, Object> visibleLeadOut(AgentSessionApi session, String query) {
        return incoming(session, query).map(IntentHandoff::serviceLeadOut)
                .orElseGet(() -> ServiceLeadOutRoutingContext.current(session));
    }

    /**
     * Store the request snapshot in this Agent's checkpoint for later model calls.
     *
     * @param session 当前 Agent 会话
     * @param reply 客户确认回复
     * @param leadOut 已展示的带出信息
     */
    public static void remember(AgentSessionApi session, String reply, Map<String, Object> leadOut) {
        if (session == null || reply == null || reply.isBlank() || leadOut == null || leadOut.isEmpty()) {
            return;
        }
        Map<String, Object> exchange = new LinkedHashMap<>(projection(leadOut));
        if (displayed(exchange).isBlank()) {
            return;
        }
        exchange.put("reply", reply);
        ServiceLeadOutRoutingContext.save(session, reply, exchange);
    }

    /**
     * forModel
     *
     * @param session session
     * @param query query
     * @return Map<String,Object>
     */
    public static Map<String, Object> forModel(AgentSessionApi session, String query) {
        return visibleLeadOut(session, query);
    }

    /**
     * accepted
     *
     * @param session session
     * @return Map<String,Object>
     */
    public static Map<String, Object> current(AgentSessionApi session) {
        return ServiceLeadOutRoutingContext.current(session);
    }

    /**
     * clearAccepted
     *
     * @param session session
     */
    public static void clear(AgentSessionApi session) {
        if (session != null) {
            ServiceLeadOutRoutingContext.clear(session);
        }
    }

    /**
     * reply
     *
     * @param leadOut leadOut
     * @param query query
     * @return String
     */
    public static String reply(Map<String, Object> leadOut, String query) {
        return leadOut.get("reply") instanceof String text && !text.isBlank() ? text : query;
    }

    /**
     * displayed
     *
     * @param leadOut leadOut
     * @return String
     */
    public static String displayed(Map<String, Object> leadOut) {
        String text = leadOut.get("displayedText") instanceof String value ? value : "";
        Object raw = leadOut.get("offers");
        if (!(raw instanceof List<?> offers) || offers.isEmpty()) {
            return text;
        }
        String items = offers.stream().map(Json::object).map(offer -> String.valueOf(offer.getOrDefault("title", ""))
                + " " + offer.getOrDefault("hint", "")).reduce((first, second) -> first + "; " + second).orElse("");
        return text.isBlank() ? items : text + "\n展示的服务: " + items;
    }

    /**
     * projection
     *
     * @param source source
     * @return Map<String,Object>
     */
    public static Map<String, Object> projection(Map<String, Object> source) {
        return com.moaagent.agent.support.MetadataSnapshot.copy(source, 65536);
    }

    /**
     * 提取允许进入模型上下文的服务带出字段。
     *
     * @param source 待投影或复制的原始字段
     * @return 允许进入模型上下文的字段；没有可用信息时为空映射
     */
    public static Map<String, Object> modelProjection(Map<String, Object> source) {
        if (source == null || source.isEmpty()) {
            return Map.of();
        }
        Map<String, Object> result = new LinkedHashMap<>();
        for (String key : List.of("sourceAgent", "sourceTask", "displayedText", "reply")) {
            boundedText(source, key, "reply".equals(key) ? 16384 : 4096)
                    .ifPresent(text -> result.put(key, text));
        }
        if (source.get("offers") instanceof List<?> offers) {
            if (offers.size() > 16) {
                throw new IllegalArgumentException("带出候选过多");
            }
            result.put("offers", offers.stream().map(Json::object).map(IntentHandoff::projectOffer).toList());
        }
        return Map.copyOf(result);
    }

    private static Map<String, String> projectOffer(Map<String, Object> offer) {
        Map<String, String> item = new LinkedHashMap<>();
        for (String key : List.of("capabilityId", "title", "hint")) {
            boundedText(offer, key, 512).ifPresent(text -> item.put(key, text));
        }
        return Map.copyOf(item);
    }

    private static Optional<String> boundedText(Map<String, Object> source, String key, int limit) {
        if (!(source.get(key) instanceof String text)) {
            return Optional.empty();
        }
        if (text.length() > limit) {
            throw new IllegalArgumentException("带出投影超出预算");
        }
        return Optional.of(text);
    }
}
