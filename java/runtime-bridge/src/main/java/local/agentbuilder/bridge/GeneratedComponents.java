package local.agentbuilder.bridge;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.session.AgentSessionApi;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/** Components bound into the running JAR by the platform packager. Not an OS sandbox. */
public final class GeneratedComponents {
    private static final String SKILL = "skills/equipment-query/SKILL.md";
    private final Map<String,Object> manifest;
    private final Class<? extends Tool> toolClass;
    private final Path skill;
    private GeneratedComponents(Map<String,Object> manifest, Class<? extends Tool> toolClass, Path skill) {
        this.manifest = Map.copyOf(manifest); this.toolClass = toolClass; this.skill = skill;
    }
    public static GeneratedComponents none() { return new GeneratedComponents(Map.of(), null, null); }
    public static GeneratedComponents load(ClassLoader loader, Path workspace, String specDigest) throws Exception {
        byte[] bytes = resource(loader, "generated/agent-builder-component.json", true);
        if (bytes == null) return none();
        Map<String,Object> data = new ObjectMapper().readValue(bytes, new TypeReference<Map<String,Object>>() {});
        if (!data.keySet().equals(Set.of("kind", "developmentBundleDigest", "sdkArtifactDigest", "snapshotId", "specDigest", "componentDigest", "skillDigest", "classes"))
                || !"equipment-tool-skill@1".equals(data.get("kind"))) throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        for (String field : List.of("developmentBundleDigest", "sdkArtifactDigest", "specDigest", "componentDigest", "skillDigest"))
            if (!(data.get(field) instanceof String value) || !value.matches("[a-f0-9]{64}")) throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        if (!(data.get("snapshotId") instanceof String id) || !id.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")) throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        if (!specDigest.equals(data.get("specDigest"))) throw new IllegalStateException("GENERATED_SPEC_MISMATCH");
        byte[] markdown = resource(loader, SKILL, false);
        if (!hash(markdown).equals(data.get("skillDigest"))) throw new IllegalStateException("GENERATED_SKILL_MISMATCH");
        if (!(data.get("classes") instanceof Map<?,?> classes) || classes.isEmpty() || classes.size() > 32 || !classes.containsKey("generated/EquipmentTool.class")) throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        for (var item : classes.entrySet()) {
            if (!(item.getKey() instanceof String path) || !path.matches("generated/EquipmentTool(\\$[A-Za-z0-9_$]+)?\\.class")
                    || !(item.getValue() instanceof String digest) || !digest.matches("[a-f0-9]{64}")) throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
            if (!hash(resource(loader, path, false)).equals(digest)) throw new IllegalStateException("GENERATED_CLASS_MISMATCH");
        }
        Class<? extends Tool> type = Class.forName("generated.EquipmentTool", false, loader).asSubclass(Tool.class);
        if (type.getSuperclass() != Tool.class) throw new IllegalStateException("GENERATED_TOOL_CONTRACT_INVALID");
        for (var method : type.getDeclaredMethods())
            if (Set.of("invoke", "stream", "streamInternal").contains(method.getName())) throw new IllegalStateException("GENERATED_TOOL_CONTRACT_INVALID");
        type.getConstructor(Tool.class);
        Path target = workspace.toAbsolutePath().normalize().resolve(SKILL);
        Path current = workspace.toAbsolutePath().normalize();
        if (Files.isSymbolicLink(current)) throw new IllegalStateException("GENERATED_SKILL_PATH_INVALID");
        for (Path part : Path.of(SKILL)) { current = current.resolve(part); if (Files.isSymbolicLink(current)) throw new IllegalStateException("GENERATED_SKILL_PATH_INVALID"); }
        Files.createDirectories(target.getParent()); Files.write(target, markdown);
        return new GeneratedComponents(data, type, target);
    }
    private static byte[] resource(ClassLoader loader, String path, boolean optional) throws Exception {
        try (var stream = loader.getResourceAsStream(path)) {
            if (stream == null) { if (optional) return null; throw new IllegalStateException("GENERATED_RESOURCE_MISSING"); }
            byte[] data = stream.readNBytes(262145);
            if (data.length > 262144) throw new IllegalStateException("GENERATED_RESOURCE_TOO_LARGE");
            return data;
        }
    }
    static String hash(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    public boolean enabled() { return toolClass != null; }
    public Map<String,Object> manifest() { return manifest; }
    Path skillRoot() { return skill.getParent().getParent(); }
    void verifySkill() {
        try {
            if (Files.isSymbolicLink(skillRoot()) || Files.isSymbolicLink(skill.getParent()) || !Files.isRegularFile(skill, LinkOption.NOFOLLOW_LINKS)
                    || !hash(Files.readAllBytes(skill)).equals(manifest.get("skillDigest"))) throw new IllegalStateException("GENERATED_SKILL_MISMATCH");
        } catch (Exception error) { throw new IllegalStateException("GENERATED_SKILL_MISMATCH"); }
    }
    static String sessionId(Map<String,Object> kwargs) { return kwargs.get("session") instanceof AgentSessionApi session ? session.getSessionId() : ""; }
    public Tool wrap(Tool transport, Consumer<Map<String,Object>> events) throws Exception {
        if (!enabled() || !"get_equipment".equals(transport.getCard().getName())) throw new IllegalStateException("GENERATED_TOOL_BINDING_INVALID");
        Tool generated = toolClass.getConstructor(Tool.class).newInstance(transport);
        if (generated.getCard() != transport.getCard()) throw new IllegalStateException("GENERATED_TOOL_CONTRACT_INVALID");
        return new Tool(transport.getCard()) {
            @Override protected Object invokeInternal(Map<String,Object> input, Map<String,Object> kwargs) throws Exception {
                events.accept(Map.of("event", "generated_tool_invoked", "className", toolClass.getName(), "componentDigest", manifest.get("componentDigest"),
                        "developmentBundleDigest", manifest.get("developmentBundleDigest"), "sessionId", sessionId(kwargs)));
                try { return generated.invoke(input, kwargs); }
                catch (IllegalStateException error) { return RegisteredHttpTool.readFailure(error); }
            }
        };
    }
}
