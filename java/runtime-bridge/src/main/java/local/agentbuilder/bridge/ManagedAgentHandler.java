package local.agentbuilder.bridge;

import com.openjiuwen.service.spec.dto.QueryResponse;
import com.openjiuwen.service.spec.dto.ServeRequest;
import com.openjiuwen.service.spec.spi.AgentHandler;
import com.openjiuwen.service.spec.spi.QueryStreamObserver;
import java.util.Optional;

/** Retains upstream Runtime handling while tracking the real native invocation lifetime. */
public final class ManagedAgentHandler implements AgentHandler {
    private final AgentHandler delegate;
    private final SessionExecutions executions;
    public ManagedAgentHandler(AgentHandler delegate, SessionExecutions executions) { this.delegate = delegate; this.executions = executions; }
    @Override public QueryResponse query(ServeRequest request) {
        String id = request.getConversationId(); executions.enter(id);
        try { return delegate.query(request); } finally { executions.leave(id); }
    }
    @Override public void streamQuery(ServeRequest request, QueryStreamObserver observer) {
        // Runner uses non-streaming SDK calls and exposes its own durable event stream.
        // Do not admit an unmanaged native stream that bypasses owned model cancellation.
        throw new UnsupportedOperationException("NATIVE_STREAM_NOT_SUPPORTED");
    }
    @Override public void start() { delegate.start(); }
    @Override public void stop() { delegate.stop(); }
    @Override public void clearSession(String id) { delegate.clearSession(id); }
    @Override public Optional<Object> prepareTask(ServeRequest request) { return delegate.prepareTask(request); }
    @Override public void completeTask(Optional<Object> token) { delegate.completeTask(token); }
}
