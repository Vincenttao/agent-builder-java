/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.openjiuwen.service.adapters.agentcore.ext.context;

import com.openjiuwen.core.session.AgentSessionApi;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Accessor for the request-scoped response metadata collected by an AgentCore
 * execution.
 *
 * <p>The environment is deliberately separate from {@code runtime.request_context}:
 * request metadata describes the current input, while response metadata is
 * produced by the current execution and is exported only at successful
 * completion.</p>
 *
 * @since 0.1.1
 */
public final class ResponseMetadataAccessor {
    /** Session environment key reserved for response metadata. */
    public static final String RESPONSE_METADATA = "runtime.response_metadata";

    private ResponseMetadataAccessor() {
    }

    /**
     * Returns an isolated snapshot. Mutating the returned map cannot mutate the
     * active Session environment.
     *
     * @param session request-scoped AgentCore Session
     * @return copied metadata, or an empty map for unsupported sessions
     */
    public static Map<String, Object> snapshot(Object session) {
        if (!(session instanceof AgentSessionApi api)) {
            return Map.of();
        }
        return copyMap(com.moaagent.compat.CoreApi.env(api, RESPONSE_METADATA));
    }

    /**
     * Adds one response metadata entry.
     *
     * @param session request-scoped AgentCore Session
     * @param key metadata key
     * @param value metadata value
     */
    @SuppressWarnings("unchecked")
    public static void put(Object session, String key, Object value) {
        if (session instanceof AgentSessionApi api && key != null && !key.isBlank()
                && com.moaagent.compat.CoreApi.env(api, RESPONSE_METADATA) instanceof Map<?, ?> map) {
            synchronized (map) {
                ((Map<String, Object>) map).put(key, copyValue(value));
            }
        }
    }

    /**
     * Adds response metadata entries to the active request Session.
     *
     * @param session request-scoped AgentCore Session
     * @param values metadata entries to add
     */
    public static void putAll(Object session, Map<String, ?> values) {
        if (values == null || values.isEmpty()) {
            return;
        }
        values.forEach((key, value) -> put(session, key, value));
    }

    /**
     * Clears metadata collected by the current request.
     *
     * @param session request-scoped AgentCore Session
     */
    public static void clear(Object session) {
        if (session instanceof AgentSessionApi api && com.moaagent.compat.CoreApi.env(api, RESPONSE_METADATA) instanceof Map<?, ?> map) {
            synchronized (map) {
                map.clear();
            }
        }
    }

    /**
     * Removes one metadata entry from the current request.
     *
     * @param session request-scoped AgentCore Session
     * @param key metadata key to remove
     */
    public static void remove(Object session, String key) {
        if (session instanceof AgentSessionApi api && com.moaagent.compat.CoreApi.env(api, RESPONSE_METADATA) instanceof Map<?, ?> map) {
            synchronized (map) {
                map.remove(key);
            }
        }
    }

    static Map<String, Object> copyMap(Object raw) {
        if (!(raw instanceof Map<?, ?> map)) {
            return Map.of();
        }
        Map<String, Object> copy = new LinkedHashMap<>();
        synchronized (map) {
            map.forEach((key, value) -> {
                if (key != null) {
                    copy.put(String.valueOf(key), copyValue(value));
                }
            });
        }
        return copy;
    }

    private static Object copyValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            return copyMap(map);
        }
        if (value instanceof List<?> list) {
            List<Object> copy = new ArrayList<>(list.size());
            list.forEach(item -> copy.add(copyValue(item)));
            return copy;
        }
        return value;
    }
}
