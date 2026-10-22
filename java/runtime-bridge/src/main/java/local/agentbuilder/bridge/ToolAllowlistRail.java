package local.agentbuilder.bridge;

import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.AgentRail;
import com.openjiuwen.core.singleagent.rail.ToolCallInputs;
import com.openjiuwen.core.foundation.llm.schema.ToolCall;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/** Runtime policy hook, not an OS sandbox. Only the bound tool list may be invoked. */
public final class ToolAllowlistRail extends AgentRail {
    private final Set<String> allowed;
    private final Consumer<Map<String, Object>> events;
    public ToolAllowlistRail(Set<String> allowed, Consumer<Map<String, Object>> events) {
        this.allowed = Set.copyOf(allowed); this.events = events; setPriority(100);
    }
    @Override public void beforeToolCall(AgentCallbackContext context) {
        String tool = context.getInputs() instanceof ToolCallInputs inputs ? inputs.getToolName() : "";
        boolean permitted = allowed.contains(tool);
        String session = context.getSession() == null ? "" : context.getSession().getSessionId();
        events.accept(Map.of("rail", "tool-allowlist", "event", "before_tool_call", "tool", tool, "allowed", permitted, "sessionId", session));
        if (!permitted) context.requestForceFinish(Map.of("output", "TOOL_NOT_ALLOWED", "result_type", "error"));
        if (permitted && context.getSession() != null && context.getInputs() instanceof ToolCallInputs inputs && inputs.getToolCall() instanceof ToolCall call)
            context.getSession().updateState(Map.of("builderToolCallId", call.getId()));
    }
}
