package local.agentbuilder.bridge;

import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.AgentRail;
import com.openjiuwen.core.singleagent.rail.ToolCallInputs;
import com.openjiuwen.core.singleagent.rail.ModelCallInputs;
import com.openjiuwen.core.foundation.llm.schema.AssistantMessage;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/** Evidence metadata and bounded public assistant output; never prompts or private reasoning. */
public final class AuditRail extends AgentRail {
    private final Consumer<Map<String, Object>> events;
    private final int maxIterations;
    private final Map<String, Integer> modelCalls = new ConcurrentHashMap<>();
    private final Set<String> iterationLimitReported = ConcurrentHashMap.newKeySet();
    public AuditRail(Consumer<Map<String, Object>> events, int maxIterations) { this.events = events; this.maxIterations = maxIterations; }
    @Override public void beforeInvoke(AgentCallbackContext context) {
        if (context.getSession() != null) {
            String session = context.getSession().getSessionId();
            modelCalls.put(session, 0);
            iterationLimitReported.remove(session);
            Object previous = context.getSession().getState("builderAuditTurns");
            int count = previous instanceof Number value ? value.intValue() : 0;
            context.getSession().updateState(Map.of("builderAuditTurns", count + 1));
        }
        emit("before_invoke", context);
    }
    @Override public void afterInvoke(AgentCallbackContext context) { emit("after_invoke", context); }
    @Override public void beforeModelCall(AgentCallbackContext context) {
        if (context.getSession() != null) modelCalls.merge(context.getSession().getSessionId(), 1, Integer::sum);
        emit("before_model_call", context);
    }
    @Override public void afterModelCall(AgentCallbackContext context) {
        emit("after_model_call", context);
        if (context.getInputs() instanceof ModelCallInputs inputs && inputs.getResponse() instanceof AssistantMessage message) {
            String content = message.getContentAsString();
            if (content != null && !content.isBlank()) events.accept(Map.of("rail", "audit", "event", "assistant_output", "sessionId", context.getSession().getSessionId(), "content", content.substring(0, Math.min(content.length(), 4000))));
        }
    }
    @Override public void beforeToolCall(AgentCallbackContext context) { emit("before_tool_call", context); }
    @Override public void afterToolCall(AgentCallbackContext context) {
        if (context.getInputs() instanceof ToolCallInputs inputs && inputs.getToolResult() instanceof RegisteredHttpTool.ReadFailure) emit("tool_error", context);
        emit("after_tool_call", context);
        if (context.getSession() != null) {
            String session = context.getSession().getSessionId();
            int calls = modelCalls.getOrDefault(session, 0);
            if (calls >= maxIterations && iterationLimitReported.add(session)) {
                events.accept(Map.of("rail", "audit", "event", "iteration_limit_reached", "sessionId", session,
                        "maxIterations", maxIterations, "modelCallCount", calls));
            }
        }
    }
    @Override public void onToolException(AgentCallbackContext context) { emit("tool_error", context); }
    @Override public void onModelException(AgentCallbackContext context) { emit("model_error", context); }
    private void emit(String event, AgentCallbackContext context) {
        String tool = context.getInputs() instanceof ToolCallInputs inputs ? inputs.getToolName() : "";
        String session = context.getSession() == null ? "" : context.getSession().getSessionId();
        Object count = context.getSession() == null ? 0 : context.getSession().getState("builderAuditTurns");
        events.accept(Map.of("rail", "audit", "event", event, "sessionId", session, "tool", tool, "turnCount", count == null ? 0 : count));
    }
}
