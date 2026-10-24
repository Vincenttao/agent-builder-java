/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.continuation;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.moaagent.agent.routing.context.RequestEnvelope;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.session.AgentSessionApi;

import java.io.IOException;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 解析下游返回的领域内和跨域意图切换信号。
 *
 * @since 0.1.0
 */
public final class IntentSwitch {
    /**
     * Request metadata carrying the switch count across MOA levels.
     */
    public static final String COUNT_METADATA = "moa.intent_switch_hops";

    /**
     * 跨域意图切换信号类型。
     */
    public static final String TYPE = "versatile_handoff_not_in_scope";

    /**
     * 领域内意图切换信号类型。
     */
    public static final String IN_SCOPE_TYPE = "versatile_handoff_in_scope_intent_change";

    private static final String PENDING_KEY = "__moa_pending_intent_switch__";
    private static final String COUNT_KEY = "__moa_intent_switch_count__";
    private static final Pattern MARKER = Pattern.compile("\"type\"\\s*:\\s*\"(" + TYPE + "|" + IN_SCOPE_TYPE + ")\"");

    private IntentSwitch() {
    }

    /**
     * Extracts a normalized signal payload.
     *
     * @param result execution result
     * @return normalized signal payload
     */
    public static Map<String, Object> payload(Object result) {
        return java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(signal(result, 0)));
    }

    /**
     * Stores a signal for processing at the next rail boundary.
     *
     * @param session current session
     * @param result signal result
     */
    public static void pending(AgentSessionApi session, Object result) {
        session.updateState(Map.of(PENDING_KEY, Json.write(payload(result))));
    }

    /**
     * Takes and clears a pending signal.
     *
     * @param session current session
     * @return pending signal or an empty map
     */
    public static Map<String, Object> takePending(AgentSessionApi session) {
        Map<String, Object> result = Json.object(session.getState(PENDING_KEY));
        if (!result.isEmpty()) {
            session.updateState(Map.of(PENDING_KEY, "{}"));
        }
        return result;
    }

    /**
     * Resets the local switch counter from request metadata.
     *
     * @param session current session
     */
    public static void resetCount(AgentSessionApi session) {
        Object incoming = com.moaagent.agent.support.RequestContextAccessor.metadata(session).get(COUNT_METADATA);
        int count = incoming instanceof Number number ? Math.max(0, Math.min(101, number.intValue())) : 0;
        session.updateState(Map.of(COUNT_KEY, count));
    }

    /**
     * Returns the current local switch count.
     *
     * @param session current session
     * @return switch count
     */
    public static int count(AgentSessionApi session) {
        Object value = session.getState(COUNT_KEY);
        return value instanceof Number number ? number.intValue() : 0;
    }

    /**
     * Advances the local switch count using a downstream reported count.
     *
     * @param session current session
     * @param result downstream result
     * @return updated switch count
     */
    public static int advanceCount(AgentSessionApi session, Object result) {
        Object stored = session.getState(COUNT_KEY);
        int count = stored instanceof Number number ? number.intValue() : 0;
        Object reported = signal(result, 0).get("moa_switch_hops");
        int remote = reported instanceof Number number ? Math.max(0, Math.min(101, number.intValue())) : 0;
        count = Math.max(count + 1, remote);
        session.updateState(Map.of(COUNT_KEY, count));
        return count;
    }

    /**
     * 判断返回内容是否包含受支持的意图切换信号。
     *
     * @param result 已获得的执行结果
     * @return 是否满足所述条件
     */
    public static boolean detected(Object result) {
        if (result == null) {
            return false;
        }
        return !signal(result, 0).isEmpty();
    }

    /**
     * 提取意图切换类型，未识别到信号时返回空字符串。
     *
     * @param result 已获得的执行结果
     * @return 提取意图切换类型，未识别到信号时返回空字符串
     */
    public static String type(Object result) {
        return String.valueOf(signal(result, 0).getOrDefault("type", ""));
    }

    /**
     * 提取领域内切换显式携带的细化意图。
     *
     * @param result 已获得的执行结果
     * @return 提取领域内切换显式携带的细化意图
     */
    public static String intent(Object result) {
        Map<String, Object> payload = signal(result, 0);
        return IN_SCOPE_TYPE.equals(payload.get("type")) && payload.get("intent") instanceof String intent
                && !intent.isBlank() ? intent : "";
    }

    /**
     * 提取切换请求；缺失时保留调用方提供的原始请求。
     *
     * @param result 已获得的执行结果
     * @param runtimeQuery 运行时当前请求文本
     * @param originalQuery 未提取到切换请求时使用的原始文本
     * @return 提取切换请求；缺失时保留调用方提供的原始请求
     */
    public static String query(Object result, String runtimeQuery, String originalQuery) {
        String runtimeText = runtimeQuery;
        if (runtimeQuery != null) {
            runtimeText = RequestEnvelope.query(runtimeQuery);
        }
        if (runtimeText != null && !runtimeText.isBlank() && !runtimeText.equals(originalQuery)) {
            return runtimeQuery;
        }
        Map<String, Object> payload = signal(result, 0);
        Object query = payload.get("query");
        if (!(query instanceof String text) || text.isBlank()) {
            query = payload.get("user_query");
        }
        if (query instanceof String text && !text.isBlank() && !text.equals(originalQuery)) {
            return text;
        }
        return "";
    }

    private static Map<String, Object> signal(Object result, int depth) {
        if (result == null || depth > 8) {
            return Map.of();
        }
        String text = result instanceof String value ? value : Json.write(result);
        try (JsonParser parser = Json.MAPPER.getFactory().createParser(text)) {
            JsonToken token;
            while ((token = parser.nextToken()) != null) {
                if (token != JsonToken.START_OBJECT) {
                    parser.skipChildren();
                    continue;
                }
                Map<String, Object> payload = Json.object(parser.readValueAsTree());
                if (TYPE.equals(payload.get("type")) || IN_SCOPE_TYPE.equals(payload.get("type"))) {
                    return payload;
                }
                Map<String, Object> nested = signal(payload.get("result"), depth + 1);
                if (!nested.isEmpty()) {
                    return nested;
                }
            }
        } catch (IOException exception) {
            return recoverSignal(text);
        }
        return Map.of();
    }

    private static Map<String, Object> recoverSignal(String text) {
        var marker = MARKER.matcher(text);
        if (!marker.find()) {
            return Map.of();
        }
        String type = marker.group(1);
        int start = text.lastIndexOf('{', marker.start());
        if (start >= 0) {
            try (JsonParser recovery = Json.MAPPER.getFactory().createParser(text.substring(start))) {
                Map<String, Object> payload = Json.object(recovery.readValueAsTree());
                if (type.equals(payload.get("type"))) {
                    return payload;
                }
            } catch (IOException ignored) {
                return Map.of("type", type);
            }
        }
        return Map.of("type", type);
    }
}
