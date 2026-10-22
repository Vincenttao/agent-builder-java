package local.agentbuilder.bridge;

import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import com.openjiuwen.harness.deep_agent.DeepAgent;
import com.openjiuwen.harness.rails.skills.SkillUseRail;
import com.openjiuwen.harness.tools.ToolOutput;
import com.openjiuwen.harness.tools.skills.SkillTool;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/** SDK discovery/prompt/loading with an exact, digest-checked skill read contract. */
public final class ManagedSkillRail extends SkillUseRail {
    private final GeneratedComponents components;
    private final Consumer<Map<String,Object>> events;
    public ManagedSkillRail(GeneratedComponents components, Consumer<Map<String,Object>> events) {
        super(List.of(components.skillRoot().toString()), "all", List.of("equipment-query"), List.of(), List.of(), false, false);
        this.components = components; this.events = events;
    }
    @Override public void reloadSkills() { components.verifySkill(); super.reloadSkills(); }
    @Override public void init(DeepAgent agent) {
        super.init(agent);
        if (getSkillsMeta().size() != 1 || !"equipment-query".equals(getSkillsMeta().getFirst().name())) throw new IllegalStateException("GENERATED_SKILL_INVALID");
        agent.unregisterTool("skill_tool"); agent.registerTool(managedTool());
    }
    Tool managedTool() {
        SkillTool sdk = new SkillTool(this::getSkillsMeta);
        return new Tool(new ToolCard("skill_tool", "skill_tool", "Read the registered equipment-query Skill before querying equipment.",
                Map.of("type", "object", "properties", Map.of("skill_name", Map.of("type", "string", "enum", List.of("equipment-query")),
                        "relative_file_path", Map.of("type", "string", "enum", List.of("SKILL.md"))), "required", List.of("skill_name"), "additionalProperties", false))) {
            @Override protected Object invokeInternal(Map<String,Object> input, Map<String,Object> kwargs) throws Exception {
                if (!Set.of("skill_name", "relative_file_path").containsAll(input.keySet()) || !"equipment-query".equals(input.get("skill_name"))
                        || input.containsKey("relative_file_path") && !"SKILL.md".equals(input.get("relative_file_path"))) throw new IllegalArgumentException("SKILL_READ_NOT_ALLOWED");
                components.verifySkill();
                Object value = sdk.invoke(input, kwargs);
                if (!(value instanceof ToolOutput output) || !output.isSuccess() || !(output.getData() instanceof Map<?,?> data)
                        || !(data.get("skill_content") instanceof String text) || !GeneratedComponents.hash(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)).equals(components.manifest().get("skillDigest")))
                    throw new IllegalStateException("GENERATED_SKILL_MISMATCH");
                events.accept(Map.of("event", "skill_loaded", "skill", "equipment-query", "skillDigest", components.manifest().get("skillDigest"),
                        "developmentBundleDigest", components.manifest().get("developmentBundleDigest"), "sessionId", GeneratedComponents.sessionId(kwargs)));
                return value;
            }
        };
    }
}
