package local.agentbuilder.bridge;

import java.util.List;

/** Immutable bridge input. Secrets and URLs belong to separately bound connections. */
public record AgentSpec(String id, String type, String systemPrompt, int maxIterations, List<String> rails) {
    public AgentSpec { rails = List.copyOf(rails); }
}
