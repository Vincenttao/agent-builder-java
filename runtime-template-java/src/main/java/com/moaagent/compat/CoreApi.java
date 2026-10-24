package com.moaagent.compat;

import com.openjiuwen.core.session.AgentSessionApi;
import com.openjiuwen.core.session.AgentSession;
import com.openjiuwen.harness.deep_agent.DeepAgentSession;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.schema.ToolInfo;
import com.openjiuwen.core.foundation.llm.schema.ToolCall;
import java.util.Map;

/** Explicit compatibility for the pinned Core 0.1.17 public session and tool APIs. */
public final class CoreApi {
    private CoreApi() { }
    public static Object env(AgentSessionApi session, String key) {
        if (session instanceof AgentSession value) return value.getEnv(key);
        if (session instanceof DeepAgentSession value) return value.getInner().config().getEnv(key);
        return session.getEnvs().get(key);
    }
    public static void putEnv(AgentSessionApi session, String key, Object value) {
        if (session instanceof AgentSession target) target.getInner().config().setEnvs(Map.of(key,value));
        else if (session instanceof DeepAgentSession target) target.getInner().config().setEnvs(Map.of(key,value));
        else throw new IllegalArgumentException("Session implementation has no supported mutable env boundary");
    }
    public static String toolName(Object tool) {
        if (tool instanceof ToolInfo value) return value.getName();
        if (tool instanceof Tool value) return value.getCard().getName();
        if (tool instanceof Map<?,?> value) {
            Object function=value.get("function");
            Object name=function instanceof Map<?,?> nested?nested.get("name"):value.get("name");
            return name instanceof String text?text:"";
        }
        return "";
    }
    public static String toolCallId(Object value) {
        if (value instanceof ToolCall call) return call.getId();
        throw new IllegalArgumentException("Expected a Core ToolCall");
    }
}
