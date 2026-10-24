/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.openjiuwen.service.adapters.agentcore.ext.context;

import com.openjiuwen.core.session.AgentSessionApi;

import java.util.Map;

/**
 * Read-only access to successful A2A response metadata for the current resume,
 * keyed by tool call ID.
 *
 * @since 0.1.1
 */
public final class RemoteResponseMetadataAccessor {
    /** Session environment key containing response metadata received from remote tools. */
    public static final String REMOTE_RESPONSE_METADATA = "runtime.remote_response_metadata";

    private RemoteResponseMetadataAccessor() {
    }

    /**
     * Returns a detached copy for one completed remote tool call.
     *
     * @param session session containing remote response metadata
     * @param toolCallId remote tool call identifier
     * @return copied metadata, or an empty map when no metadata is available
     */
    public static Map<String, Object> forToolCall(Object session, String toolCallId) {
        if (!(session instanceof AgentSessionApi api) || toolCallId == null
                || !(com.moaagent.compat.CoreApi.env(api, REMOTE_RESPONSE_METADATA) instanceof Map<?, ?> responses)) {
            return Map.of();
        }
        return ResponseMetadataAccessor.copyMap(responses.get(toolCallId));
    }
}
