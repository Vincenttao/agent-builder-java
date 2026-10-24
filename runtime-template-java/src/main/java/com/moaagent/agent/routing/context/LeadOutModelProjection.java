/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.routing.context;

import com.moaagent.agent.support.Json;
import com.openjiuwen.core.foundation.llm.schema.AssistantMessage;
import com.openjiuwen.core.foundation.llm.schema.SystemMessage;
import com.openjiuwen.core.foundation.llm.schema.UserMessage;
import com.openjiuwen.core.singleagent.rail.ModelCallInputs;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Projects an accepted lead-out exchange into one model call without changing persisted history.
 *
 * @since 2026-10-06
 */
public final class LeadOutModelProjection {
    private LeadOutModelProjection() {
    }

    /**
     * project
     *
     * @param inputs inputs
     * @param leadOut leadOut
     * @param query query
     */
    public static void project(ModelCallInputs inputs, Map<String, Object> leadOut, String query) {
        if (leadOut.isEmpty() || inputs.getMessages() == null) {
            return;
        }
        String visible = IntentHandoff.displayed(leadOut);
        if (visible.isBlank()) {
            return;
        }
        String source = String.valueOf(leadOut.getOrDefault("sourceAgent", "上层 Agent"));
        String assistant = "[此前由 " + source + " 展示的服务带出，非本 Agent 的持久历史]\n" + visible;
        List<Object> messages = new ArrayList<>(inputs.getMessages());
        if (messages.stream().anyMatch(message -> message instanceof AssistantMessage previous
                && assistant.equals(previous.getContentAsString()))) {
            return;
        }
        int current = -1;
        int lastUser = -1;
        for (int index = 0; index < messages.size(); index++) {
            if (messages.get(index) instanceof UserMessage user) {
                lastUser = index;
                if (matchesAnchor(user.getContentAsString(), query)) {
                    current = index;
                }
            }
        }
        if (lastUser < 0) {
            return;
        }
        if (current < 0) {
            boolean hasPriorAssistant = messages.stream().anyMatch(AssistantMessage.class::isInstance);
            current = hasPriorAssistant ? 0 : lastUser;
            while (current < messages.size() && messages.get(current) instanceof SystemMessage) {
                current++;
            }
        }
        String reply = IntentHandoff.reply(leadOut, query);
        boolean currentHasReply = current < messages.size() && messages.get(current) instanceof UserMessage user
                && user.getContentAsString().equals(reply);
        messages.add(current, new AssistantMessage(assistant));
        if (!currentHasReply) {
            messages.add(current + 1, new UserMessage(reply));
        }
        inputs.setMessages(messages);
    }

    private static boolean matchesAnchor(String content, String query) {
        if (query == null || query.isBlank()) {
            return false;
        }
        return query.equals(content) || content.startsWith(query + "\n\n以下为本次完整请求召回")
                || content.startsWith("{") && query.equals(Json.object(content).get("query"));
    }
}
