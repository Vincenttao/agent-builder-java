package local.agentbuilder.bridge;

import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.ModelInvokeOptions;
import com.openjiuwen.core.foundation.llm.schema.AssistantMessage;
import com.openjiuwen.core.foundation.llm.schema.BaseMessage;
import java.util.List;
import java.util.concurrent.CompletionStage;

/** Associates native model waits with the owning session without exposing the internal marker. */
public final class SessionModel extends Model {
    static final String SESSION_HEADER = "X-Builder-Internal-Session";
    private final SessionExecutions executions;
    public SessionModel(Model source, SessionExecutions executions) { super(source); this.executions = executions; }
    @Override public CompletionStage<AssistantMessage> invoke(List<BaseMessage> messages, ModelInvokeOptions options) {
        var headers = options == null ? new java.util.LinkedHashMap<String,String>() : options.getRequestHeaders();
        String session = headers.remove(SESSION_HEADER);
        if (session == null || session.isBlank()) throw new IllegalStateException("MODEL_SESSION_REQUIRED");
        var outgoing = options.toBuilder().requestHeaders(headers).build();
        return executions.modelCall(session, () -> super.invoke(messages, outgoing));
    }
}
