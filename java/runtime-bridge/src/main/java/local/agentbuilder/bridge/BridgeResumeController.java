package local.agentbuilder.bridge;

import com.openjiuwen.service.spec.dto.ServeRequest;
import com.openjiuwen.service.spec.dto.QueryResponse;
import com.openjiuwen.service.spec.spi.AgentHandler;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Private Runner-authenticated adapter for SDK InteractiveInput; no original task replay. */
@RestController
public final class BridgeResumeController {
    private final AgentHandler handler;
    public BridgeResumeController(AgentHandler handler) { this.handler = handler; }
    @PostMapping("/bridge/resume")
    public QueryResponse resume(@RequestBody Map<String, Object> input) {
        if (!input.keySet().equals(Set.of("sessionId", "toolCallId", "approved")) || !(input.get("sessionId") instanceof String session)
            || !(input.get("toolCallId") instanceof String call) || call.isBlank() || call.length() > 200 || !(input.get("approved") instanceof Boolean approved))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_RESUME_INPUT");
        try { UUID.fromString(session); } catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_SESSION_ID"); }
        ServeRequest request = new ServeRequest(); request.setConversationId(session); request.setUserId("anonymous"); request.setSpaceId("default"); request.setStream(false);
        request.setMetadata(Map.of("runtime.remoteToolResults", Map.of(call, Map.of("approved", approved, "auto_confirm", false))));
        return handler.query(request);
    }
}
