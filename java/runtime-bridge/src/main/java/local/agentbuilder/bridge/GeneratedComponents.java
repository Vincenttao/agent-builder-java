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
import java.util.HashMap;
import java.util.function.Consumer;

/** Components bound into the running JAR by the platform packager. Not an OS sandbox. */
public final class GeneratedComponents {
    private static final String LEGACY_SKILL = "skills/equipment-query/SKILL.md";
    private final Map<String,Object> manifest;
    private final Class<? extends Tool> toolClass;
    private final Path skill;
    private final String toolName;
    private final String operationId;
    private final Map<String,String> toolBindings;
    private final String skillName;
    private final String skillPath;
    private GeneratedComponents(Map<String,Object> manifest, Class<? extends Tool> toolClass, Path skill, String toolName, String operationId, Map<String,String> toolBindings, String skillName, String skillPath) {
        this.manifest = Map.copyOf(manifest); this.toolClass = toolClass; this.skill = skill;
        this.toolName = toolName; this.operationId = operationId; this.toolBindings=Map.copyOf(toolBindings); this.skillName = skillName; this.skillPath = skillPath;
    }
    public static GeneratedComponents none() { return new GeneratedComponents(Map.of(), null, null, null, null, Map.of(), null, null); }
    public static GeneratedComponents load(ClassLoader loader, Path workspace, String specDigest) throws Exception {
        byte[] bytes = resource(loader, "generated/agent-builder-component.json", true);
        if (bytes == null) return none();
        Map<String,Object> data = new ObjectMapper().readValue(bytes, new TypeReference<Map<String,Object>>() {});
        boolean legacy = "equipment-tool-skill@1".equals(data.get("kind"));
        Set<String> legacyKeys=Set.of("kind", "developmentBundleDigest", "sdkArtifactDigest", "snapshotId", "specDigest", "componentDigest", "skillDigest", "classes");
        Set<String> generatedKeys=Set.of("kind", "developmentBundleDigest", "sdkArtifactDigest", "snapshotId", "specDigest", "componentDigest", "skillDigest", "classes", "toolClassName", "toolName", "operationId", "skillName", "skillPath");
        Set<String> generatedKeysV2=new java.util.HashSet<>(generatedKeys);generatedKeysV2.add("toolBindings");
        boolean multi="generated-tool-skill@2".equals(data.get("kind"))&&data.keySet().equals(generatedKeysV2);
        Set<String> generatedKeysV3=new java.util.HashSet<>(generatedKeys);generatedKeysV3.add("generatedScope");
        Set<String> generatedKeysV3Multi=new java.util.HashSet<>(generatedKeysV3);generatedKeysV3Multi.add("toolBindings");
        boolean scoped="generated-tool-skill@3".equals(data.get("kind"))&&(data.keySet().equals(generatedKeysV3)||data.keySet().equals(generatedKeysV3Multi));
        boolean scopedMulti=scoped&&data.keySet().contains("toolBindings");
        if (!(legacy && data.keySet().equals(legacyKeys) || "generated-tool-skill@1".equals(data.get("kind")) && data.keySet().equals(generatedKeys) || multi || scoped))
            throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        if(scoped&&(!(data.get("generatedScope") instanceof List<?> scope)||scope.size()!=1||!("tool".equals(scope.get(0))||"skill".equals(scope.get(0)))))
            throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        for (String field : List.of("developmentBundleDigest", "sdkArtifactDigest", "specDigest", "componentDigest", "skillDigest"))
            if (!(data.get(field) instanceof String value) || !value.matches("[a-f0-9]{64}")) throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        if (!(data.get("snapshotId") instanceof String id) || !id.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")) throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        if (!specDigest.equals(data.get("specDigest"))) throw new IllegalStateException("GENERATED_SPEC_MISMATCH");
        String toolClassName=legacy?"generated.EquipmentTool":string(data,"toolClassName");
        String toolName=legacy?"get_equipment":string(data,"toolName");
        String operationId=legacy?"equipment-status":string(data,"operationId");
        Map<String,String> bindings=new HashMap<>();
        if(multi||scopedMulti){
            if(!(data.get("toolBindings") instanceof List<?> entries)||entries.size()<2||entries.size()>16)throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
            for(Object entry:entries){
                if(!(entry instanceof Map<?,?> binding)||!binding.keySet().equals(Set.of("toolClassName","toolName","operationId")))throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
                if(!(binding.get("toolClassName") instanceof String boundClass)||!boundClass.equals(toolClassName)
                        ||!(binding.get("toolName") instanceof String boundName)||!boundName.matches("[a-z][a-z0-9_]{0,63}")
                        ||!(binding.get("operationId") instanceof String boundOperation)||!boundOperation.matches("[a-z][a-zA-Z0-9-]{0,63}")
                        ||bindings.putIfAbsent(boundName,boundOperation)!=null)throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
            }
            if(!operationId.equals(bindings.get(toolName)))throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        }else bindings.put(toolName,operationId);
        String skillName=legacy?"equipment-query":string(data,"skillName");
        String skillPath=legacy?LEGACY_SKILL:string(data,"skillPath");
        if(!toolClassName.matches("generated\\.[A-Z][A-Za-z0-9]*Tool")||!toolName.matches("[a-z][a-z0-9_]{0,63}")
                ||!operationId.matches("[a-z][a-zA-Z0-9-]{0,63}")||!skillName.matches("[a-z][a-z0-9-]{0,63}")
                ||!skillPath.matches("skills/[a-z][a-z0-9-]{0,63}/SKILL\\.md")||!skillPath.equals("skills/"+skillName+"/SKILL.md"))
            throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        String classPath=toolClassName.replace('.','/')+".class";
        byte[] markdown = resource(loader, skillPath, false);
        if (!hash(markdown).equals(data.get("skillDigest"))) throw new IllegalStateException("GENERATED_SKILL_MISMATCH");
        if (!(data.get("classes") instanceof Map<?,?> classes) || classes.isEmpty() || classes.size() > 32 || !classes.containsKey(classPath)) throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
        String classPattern=java.util.regex.Pattern.quote(classPath.substring(0,classPath.length()-6))+"(\\$[A-Za-z0-9_$]+)?\\.class";
        for (var item : classes.entrySet()) {
            if (!(item.getKey() instanceof String path) || !path.matches(classPattern)
                    || !(item.getValue() instanceof String digest) || !digest.matches("[a-f0-9]{64}")) throw new IllegalStateException("GENERATED_MANIFEST_INVALID");
            if (!hash(resource(loader, path, false)).equals(digest)) throw new IllegalStateException("GENERATED_CLASS_MISMATCH");
        }
        Class<? extends Tool> type = Class.forName(toolClassName, false, loader).asSubclass(Tool.class);
        if (type.getSuperclass() != Tool.class) throw new IllegalStateException("GENERATED_TOOL_CONTRACT_INVALID");
        for (var method : type.getDeclaredMethods())
            if (Set.of("invoke", "stream", "streamInternal").contains(method.getName())) throw new IllegalStateException("GENERATED_TOOL_CONTRACT_INVALID");
        type.getConstructor(Tool.class);
        Path target = workspace.toAbsolutePath().normalize().resolve(skillPath);
        Path current = workspace.toAbsolutePath().normalize();
        if (Files.isSymbolicLink(current)) throw new IllegalStateException("GENERATED_SKILL_PATH_INVALID");
        for (Path part : Path.of(skillPath)) { current = current.resolve(part); if (Files.isSymbolicLink(current)) throw new IllegalStateException("GENERATED_SKILL_PATH_INVALID"); }
        Files.createDirectories(target.getParent()); Files.write(target, markdown);
        return new GeneratedComponents(data, type, target, toolName, operationId, bindings, skillName, skillPath);
    }
    private static String string(Map<String,Object> data,String key){if(!(data.get(key) instanceof String value))throw new IllegalStateException("GENERATED_MANIFEST_INVALID");return value;}
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
    public String toolName(){return toolName;}
    public String operationId(){return operationId;}
    public Set<String> toolNames(){return toolBindings.keySet();}
    public String skillName(){return skillName;}
    public boolean binds(String tool,String operation){return enabled()&&operation.equals(toolBindings.get(tool));}
    Path skillRoot() { return skill.getParent().getParent(); }
    void verifySkill() {
        try {
            if (Files.isSymbolicLink(skillRoot()) || Files.isSymbolicLink(skill.getParent()) || !Files.isRegularFile(skill, LinkOption.NOFOLLOW_LINKS)
                    || !hash(Files.readAllBytes(skill)).equals(manifest.get("skillDigest"))) throw new IllegalStateException("GENERATED_SKILL_MISMATCH");
        } catch (Exception error) { throw new IllegalStateException("GENERATED_SKILL_MISMATCH"); }
    }
    static String sessionId(Map<String,Object> kwargs) { return kwargs.get("session") instanceof AgentSessionApi session ? session.getSessionId() : ""; }
    public Tool wrap(Tool transport, Consumer<Map<String,Object>> events) throws Exception {
        if (!enabled() || !toolBindings.containsKey(transport.getCard().getName())) throw new IllegalStateException("GENERATED_TOOL_BINDING_INVALID");
        Tool generated = toolClass.getConstructor(Tool.class).newInstance(transport);
        if (generated.getCard() != transport.getCard()) throw new IllegalStateException("GENERATED_TOOL_CONTRACT_INVALID");
        boolean generatedTool=!(manifest.get("generatedScope") instanceof List<?> scope)||scope.contains("tool");
        String invocationEvent=generatedTool?"generated_tool_invoked":"bound_tool_invoked";
        return new Tool(transport.getCard()) {
            @Override protected Object invokeInternal(Map<String,Object> input, Map<String,Object> kwargs) throws Exception {
                events.accept(Map.of("event", invocationEvent, "className", toolClass.getName(), "componentDigest", manifest.get("componentDigest"),
                        "developmentBundleDigest", manifest.get("developmentBundleDigest"), "sessionId", sessionId(kwargs)));
                try { return generated.invoke(input, kwargs); }
                catch (IllegalStateException error) { return RegisteredHttpTool.readFailure(error); }
            }
        };
    }
}
