/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.leadout;

import com.moaagent.agent.support.Json;
import com.openjiuwen.core.session.AgentSessionApi;
import com.openjiuwen.service.adapters.agentcore.ext.context.RemoteResponseMetadataAccessor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * ServiceLeadOutMetadata
 *
 * @since 2026-10-06
 */
public final class ServiceLeadOutMetadata {
    /**
     * KEY
     */
    public static final String KEY = "leadOut";

    private ServiceLeadOutMetadata() { }

    /**
     * forToolCall
     *
     * @param session session
     * @param callId callId
     * @return Map<String,Object>
     */
    public static Map<String, Object> forToolCall(AgentSessionApi session, String callId) {
        return project(RemoteResponseMetadataAccessor.forToolCall(session, callId));
    }

    /**
     * project
     *
     * @param metadata metadata
     * @return Map<String,Object>
     */
    public static Map<String, Object> project(Map<String, Object> metadata) {
        if (metadata == null) {
            return Map.of();
        }
        var payload = Json.object(metadata.get(KEY));
        if (!(payload.get("items") instanceof List<?> values)) {
            return Map.of();
        }
        List<ServiceLeadOutItem> items = new ArrayList<>();
        for (Object value : values) {
            var fields = Json.object(value);
            if (!(fields.get("capabilityId") instanceof String id) || id.isBlank() || id.length() > 256) {
                continue;
            }
            String hint = fields.get("hint") instanceof String text && text.length() <= 512 ? text : "";
            String interaction = "TEXT".equals(fields.get("interaction")) ? "TEXT" : "BUTTON";
            String decline = fields.get("declineResponse") instanceof String text && text.length() <= 2048
                    ? text : "";
            items.add(new ServiceLeadOutItem(id, "", hint, interaction, "LOW", decline, ""));
            if (items.size() >= 16) {
                break;
            }
        }
        return items.isEmpty() ? Map.of() : Map.of(KEY, Json.object(Json.write(
                new ServiceLeadOut(ServiceLeadOut.SCHEMA, ServiceLeadOut.SOURCE_L2, null, items))));
    }

    /**
     * merge
     *
     * @param previous previous
     * @param current current
     * @return Map<String,Object>
     */
    public static Map<String, Object> merge(Map<String, Object> previous, Map<String, Object> current) {
        List<Object> items = new ArrayList<>();
        for (var metadata : List.of(current, previous)) {
            Object values = Json.object(metadata.get(KEY)).get("items");
            if (values instanceof List<?> list) {
                items.addAll(list);
            }
        }
        return project(Map.of(KEY, Map.of("items", items)));
    }
}
