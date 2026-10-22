package local.agentbuilder.bridge;

import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.AgentRail;
import com.openjiuwen.core.singleagent.rail.ModelCallInputs;
import java.util.Map;

/** Mandatory platform lifecycle policy, independent of user-selected business rails. */
public final class SessionCancellationRail extends AgentRail {
    private final SessionExecutions executions;
    public SessionCancellationRail(SessionExecutions executions) { this.executions = executions; setPriority(1000); }
    private void check(AgentCallbackContext context) {
        if (context.getSession() != null && executions.isCancelled(context.getSession().getSessionId()))
            context.requestForceFinish(Map.of("output", "RUN_CANCELLED", "result_type", "error"));
    }
    @Override public void beforeInvoke(AgentCallbackContext context) { check(context); }
    @Override public void beforeModelCall(AgentCallbackContext context) {
        check(context);
        if (context.getSession() == null) throw new IllegalStateException("MODEL_SESSION_REQUIRED");
        ((ModelCallInputs) context.getInputs()).mergeRequestHeaders(Map.of(SessionModel.SESSION_HEADER, context.getSession().getSessionId()));
    }
    @Override public void beforeToolCall(AgentCallbackContext context) { check(context); }
}
