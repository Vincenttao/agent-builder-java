package local.agentbuilder.bridge;

import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.AgentRail;
import com.openjiuwen.core.singleagent.rail.ToolCallInputs;
import java.util.Map;
import java.util.function.Consumer;

/** Approved parameterized Rail template. The mutable counter is scoped to one SDK session and invocation. */
public final class ToolCallLimitRail extends AgentRail {
    private static final String STATE_KEY = "builderGeneratedRailToolCalls";
    private final int maximum;
    private final Consumer<Map<String, Object>> events;

    public ToolCallLimitRail(int maximum, Consumer<Map<String, Object>> events) {
        if (maximum < 1 || maximum > 20) throw new IllegalArgumentException("INVALID_RAIL_PARAMETER:maximum");
        this.maximum = maximum;
        this.events = events;
    }

    @Override public void beforeInvoke(AgentCallbackContext context) {
        if (context.getSession() != null) context.getSession().updateState(Map.of(STATE_KEY, 0));
    }

    @Override public void beforeToolCall(AgentCallbackContext context) {
        String sessionId = context.getSession() == null ? "" : context.getSession().getSessionId();
        if (context.getSession() == null || !(context.getInputs() instanceof ToolCallInputs inputs)) {
            events.accept(Map.of("rail", "tool-call-limit", "event", "context_missing", "limit", maximum, "sessionId", sessionId));
            context.requestForceFinish(Map.of("output", "TOOL_CALL_LIMIT_CONTEXT_MISSING", "result_type", "error"));
            return;
        }
        Object currentValue = context.getSession().getState(STATE_KEY);
        int current = currentValue instanceof Number number ? number.intValue() : 0;
        if (current >= maximum) {
            events.accept(Map.of("rail", "tool-call-limit", "event", "limit_reached", "limit", maximum,
                    "tool", inputs.getToolName(), "sessionId", sessionId));
            context.requestForceFinish(Map.of("output", "TOOL_CALL_LIMIT_EXCEEDED", "result_type", "error"));
            return;
        }
        context.getSession().updateState(Map.of(STATE_KEY, current + 1));
        events.accept(Map.of("rail", "tool-call-limit", "event", "call_allowed", "count", current + 1,
                "limit", maximum, "tool", inputs.getToolName(), "sessionId", sessionId));
    }
}
