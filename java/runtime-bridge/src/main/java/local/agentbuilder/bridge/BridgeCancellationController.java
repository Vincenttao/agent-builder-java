package local.agentbuilder.bridge;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@RestController
public final class BridgeCancellationController {
    private final SessionExecutions executions;
    public BridgeCancellationController(SessionExecutions executions) { this.executions = executions; }
    @PostMapping("/bridge/cancel") public Map<String, String> cancel(@RequestBody Map<String, Object> input) {
        if (!input.keySet().equals(Set.of("sessionId")) || !(input.get("sessionId") instanceof String id)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_CANCEL_INPUT");
        try { UUID.fromString(id); } catch (IllegalArgumentException error) { throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "INVALID_SESSION_ID"); }
        return Map.of("status", executions.cancel(id));
    }
}
