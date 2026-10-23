package local.agentbuilder.bridge;

import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.singleagent.schema.AgentCard;
import com.openjiuwen.harness.deep_agent.DeepAgent;
import com.openjiuwen.harness.schema.config.DeepAgentConfig;
import com.openjiuwen.harness.factory.HarnessFactory;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

public final class AgentAssembler {
    public DeepAgent assemble(AgentSpec spec, Path workspace, Model model, List<Tool> tools,
                              Consumer<Map<String, Object>> events) {
        return assemble(spec, workspace, model, tools, events, new SessionExecutions());
    }
    public DeepAgent assemble(AgentSpec spec, Path workspace, Model model, List<Tool> tools,
                              Consumer<Map<String, Object>> events, SessionExecutions executions) {
        return assemble(spec, workspace, model, tools, events, executions, GeneratedComponents.none());
    }
    public DeepAgent assemble(AgentSpec spec, Path workspace, Model model, List<Tool> tools,
                              Consumer<Map<String, Object>> events, SessionExecutions executions, GeneratedComponents components) {
        if (!"DeepAgent".equals(spec.type())) throw new IllegalArgumentException("UNSUPPORTED_AGENT_TYPE");
        if (spec.id() == null || !spec.id().matches("[a-zA-Z0-9_-]{1,80}")) throw new IllegalArgumentException("INVALID_AGENT_ID");
        if (spec.maxIterations() < 1 || spec.maxIterations() > 20) throw new IllegalArgumentException("INVALID_ITERATION_LIMIT");
        if (spec.systemPrompt() == null || spec.systemPrompt().isBlank()) throw new IllegalArgumentException("EMPTY_SYSTEM_PROMPT");
        Set<String> railIds = new HashSet<>();
        for (String rail : spec.rails()) {
            if (!Set.of("audit", "tool-allowlist", "write-confirm").contains(rail) && !toolCallLimit(rail).isPresent()) throw new IllegalArgumentException("UNKNOWN_RAIL:" + rail);
            if (!railIds.add(rail)) throw new IllegalArgumentException("CONFLICTING_RAIL:" + rail);
        }
        if (!railIds.contains("tool-allowlist")) throw new IllegalArgumentException("REQUIRED_RAIL:tool-allowlist");
        Set<String> allowedTools = new HashSet<>();
        for (Tool tool : tools) {
            if (!allowedTools.add(tool.getCard().getName())) throw new IllegalArgumentException("DUPLICATE_TOOL");
        }
        Set<String> writes = new HashSet<>(Set.of("create_work_order", "create_mock_subscription")); writes.retainAll(allowedTools);
        if (!writes.isEmpty() && !railIds.contains("write-confirm")) throw new IllegalArgumentException("REQUIRED_RAIL:write-confirm");
        List<Object> rails = new ArrayList<>();
        rails.add(new SessionCancellationRail(executions));
        if (components.enabled()) {
            if (allowedTools.size()!=1 || !allowedTools.contains(components.toolName())) throw new IllegalArgumentException("GENERATED_TOOL_BINDING_INVALID");
            allowedTools.add("skill_tool"); rails.add(new ManagedSkillRail(components, events));
        }
        for (String id : spec.rails()) {
            var callLimit = toolCallLimit(id);
            if (callLimit.isPresent()) rails.add(new ToolCallLimitRail(callLimit.getAsInt(), events));
            else rails.add(switch (id) {
                case "audit" -> new AuditRail(events, spec.maxIterations());
                case "write-confirm" -> new WriteConfirmationRail(writes, events);
                default -> new ToolAllowlistRail(allowedTools, events);
            });
        }
        DeepAgentConfig config = DeepAgentConfig.builder().systemPrompt(spec.systemPrompt())
                .workspacePath(workspace.toAbsolutePath().toString()).model(new SessionModel(model, executions)).maxIterations(spec.maxIterations())
                .maxParallelToolCalls(1).rails(rails).tools(new ArrayList<>(tools))
                .restrictToWorkDir(true).enableTaskLoop(true).enableTaskPlanning(false)
                .enableSkillDiscovery(false).addGeneralPurposeAgent(false).build();
        return HarnessFactory.createDeepAgent(AgentCard.builder().id(spec.id()).name(spec.id()).description("Agent Builder managed candidate").build(), config, null);
    }

    private java.util.OptionalInt toolCallLimit(String id) {
        if (id == null || !id.matches("tool-call-limit@1:(?:[1-9]|1[0-9]|20)")) return java.util.OptionalInt.empty();
        return java.util.OptionalInt.of(Integer.parseInt(id.substring(id.indexOf(':') + 1)));
    }
}
