package local.agentbuilder.bridge;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import javax.tools.ToolProvider;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import java.util.List;
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.CompletableFuture;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.schema.AssistantMessage;
import com.openjiuwen.core.foundation.llm.schema.ToolCall;
import com.openjiuwen.harness.tools.ToolOutput;
import static org.assertj.core.api.Assertions.*;

class GeneratedComponentsTest {
    @TempDir Path directory;
    static final String SPEC="a".repeat(64);
    private static String hash(byte[] data) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)); }
    private URLClassLoader component() throws Exception {
        Path classes=directory.resolve("classes");Files.createDirectories(classes.resolve("generated"));
        Path source=directory.resolve("EquipmentTool.java");Files.writeString(source,"""
            package generated;
            import com.openjiuwen.core.foundation.tool.Tool;
            import java.util.Map;
            public final class EquipmentTool extends Tool {
              private final Tool transport;
              public EquipmentTool(Tool transport){super(transport.getCard());this.transport=transport;}
              protected Object invokeInternal(Map<String,Object> input,Map<String,Object> kwargs)throws Exception{return transport.invoke(input,kwargs);}
            }
            """);
        assertThat(ToolProvider.getSystemJavaCompiler().run(null,null,null,"-encoding","UTF-8","--release","21","-cp",System.getProperty("java.class.path"),"-d",classes.toString(),source.toString())).isZero();
        Path skill=classes.resolve("skills/equipment-query/SKILL.md");Files.createDirectories(skill.getParent());Files.writeString(skill,"---\nname: equipment-query\ndescription: Generated equipment query fixture\n---\nUse get_equipment and do not invent business facts.\n");
        var manifest=Map.of("kind","equipment-tool-skill@1","developmentBundleDigest","b".repeat(64),"sdkArtifactDigest","c".repeat(64),"snapshotId","00000000-0000-0000-0000-000000000001","specDigest",SPEC,"componentDigest","d".repeat(64),"skillDigest",hash(Files.readAllBytes(skill)),"classes",Map.of("generated/EquipmentTool.class",hash(Files.readAllBytes(classes.resolve("generated/EquipmentTool.class")))));
        Files.writeString(classes.resolve("generated/agent-builder-component.json"),new ObjectMapper().writeValueAsString(manifest));
        return new URLClassLoader(new java.net.URL[]{classes.toUri().toURL()},Tool.class.getClassLoader());
    }
    private URLClassLoader financeComponent() throws Exception {
        Path classes=directory.resolve("finance-classes");Files.createDirectories(classes.resolve("generated"));
        Path source=directory.resolve("AccountBalanceTool.java");Files.writeString(source,"""
            package generated;
            import com.openjiuwen.core.foundation.tool.Tool;
            import java.util.Map;
            public final class AccountBalanceTool extends Tool {
              private final Tool transport;
              public AccountBalanceTool(Tool transport){super(transport.getCard());this.transport=transport;}
              protected Object invokeInternal(Map<String,Object> input,Map<String,Object> kwargs)throws Exception{return transport.invoke(input,kwargs);}
            }
            """);
        assertThat(ToolProvider.getSystemJavaCompiler().run(null,null,null,"-encoding","UTF-8","--release","21","-cp",System.getProperty("java.class.path"),"-d",classes.toString(),source.toString())).isZero();
        Path skill=classes.resolve("skills/balance-query/SKILL.md");Files.createDirectories(skill.getParent());Files.writeString(skill,"---\nname: balance-query\ndescription: Generated account balance query fixture\n---\nUse get_account_balance and report only returned fields.\n");
        var manifest=Map.ofEntries(Map.entry("kind","generated-tool-skill@1"),Map.entry("developmentBundleDigest","b".repeat(64)),Map.entry("sdkArtifactDigest","c".repeat(64)),Map.entry("snapshotId","00000000-0000-0000-0000-000000000001"),Map.entry("specDigest",SPEC),Map.entry("componentDigest","d".repeat(64)),Map.entry("skillDigest",hash(Files.readAllBytes(skill))),Map.entry("toolClassName","generated.AccountBalanceTool"),Map.entry("toolName","get_account_balance"),Map.entry("operationId","getAccountBalance"),Map.entry("skillName","balance-query"),Map.entry("skillPath","skills/balance-query/SKILL.md"),Map.entry("classes",Map.of("generated/AccountBalanceTool.class",hash(Files.readAllBytes(classes.resolve("generated/AccountBalanceTool.class"))))));
        Files.writeString(classes.resolve("generated/agent-builder-component.json"),new ObjectMapper().writeValueAsString(manifest));
        return new URLClassLoader(new java.net.URL[]{classes.toUri().toURL()},Tool.class.getClassLoader());
    }
    private URLClassLoader wealthAssistantComponent() throws Exception {
        Path classes=directory.resolve("wealth-assistant-classes");Files.createDirectories(classes.resolve("generated"));
        Path source=directory.resolve("WealthQueryTool.java");Files.writeString(source,"""
            package generated;
            import com.openjiuwen.core.foundation.tool.Tool;
            import java.util.Map;
            public final class WealthQueryTool extends Tool {
              private final Tool transport;
              public WealthQueryTool(Tool transport){super(transport.getCard());this.transport=transport;}
              protected Object invokeInternal(Map<String,Object> input,Map<String,Object> kwargs)throws Exception{return transport.invoke(input,kwargs);}
            }
            """);
        assertThat(ToolProvider.getSystemJavaCompiler().run(null,null,null,"-encoding","UTF-8","--release","21","-cp",System.getProperty("java.class.path"),"-d",classes.toString(),source.toString())).isZero();
        Path skill=classes.resolve("skills/wealth-query/SKILL.md");Files.createDirectories(skill.getParent());Files.writeString(skill,"---\nname: wealth-query\ndescription: Generated wealth query fixture\n---\nUse get_account_balance or list_wealth_products and report only returned facts.\n");
        var manifest=Map.ofEntries(Map.entry("kind","generated-tool-skill@2"),Map.entry("developmentBundleDigest","b".repeat(64)),Map.entry("sdkArtifactDigest","c".repeat(64)),Map.entry("snapshotId","00000000-0000-0000-0000-000000000001"),Map.entry("specDigest",SPEC),Map.entry("componentDigest","d".repeat(64)),Map.entry("skillDigest",hash(Files.readAllBytes(skill))),Map.entry("toolClassName","generated.WealthQueryTool"),Map.entry("toolName","get_account_balance"),Map.entry("operationId","getAccountBalance"),Map.entry("skillName","wealth-query"),Map.entry("skillPath","skills/wealth-query/SKILL.md"),Map.entry("toolBindings",List.of(Map.of("toolClassName","generated.WealthQueryTool","toolName","get_account_balance","operationId","getAccountBalance"),Map.of("toolClassName","generated.WealthQueryTool","toolName","list_wealth_products","operationId","listWealthProducts"))),Map.entry("classes",Map.of("generated/WealthQueryTool.class",hash(Files.readAllBytes(classes.resolve("generated/WealthQueryTool.class"))))));
        Files.writeString(classes.resolve("generated/agent-builder-component.json"),new ObjectMapper().writeValueAsString(manifest));
        return new URLClassLoader(new java.net.URL[]{classes.toUri().toURL()},Tool.class.getClassLoader());
    }
    @Test void loadsCombinedWealthToolsAndBindsBothOperationsToOneGeneratedSkill() throws Exception {
        try(var loader=wealthAssistantComponent()) {
            var components=GeneratedComponents.load(loader,directory.resolve("wealth-workspace"),SPEC);
            assertThat(components.toolNames()).containsExactlyInAnyOrder("get_account_balance","list_wealth_products");
            assertThat(components.binds("get_account_balance","getAccountBalance")).isTrue();
            assertThat(components.binds("list_wealth_products","listWealthProducts")).isTrue();
            assertThat(components.binds("list_wealth_products","getAccountBalance")).isFalse();
            for(String name:components.toolNames()) {
                Tool transport=new Tool(new ToolCard("finance@1",name,"fixture",Map.of())) {
                    protected Object invokeInternal(Map<String,Object> inputs,Map<String,Object> kwargs){return Map.of("tool",name);}
                };
                assertThat(components.wrap(transport,event->{}).invoke(Map.of(),Map.of())).isEqualTo(Map.of("tool",name));
            }
        }
    }
    @Test void loadsGeneratedFinanceToolAndItsProfileSpecificSkill() throws Exception {
        try(var loader=financeComponent()) {
            var components=GeneratedComponents.load(loader,directory.resolve("finance-workspace"),SPEC);
            assertThat(components.enabled()).isTrue();
            AtomicInteger calls=new AtomicInteger();List<Map<String,Object>> events=new ArrayList<>();
            Tool transport=new Tool(new ToolCard("balance@1","get_account_balance","fixture",Map.of())) {
                protected Object invokeInternal(Map<String,Object> inputs,Map<String,Object> kwargs){calls.incrementAndGet();assertThat(inputs).containsEntry("accountId","A1001");return Map.of("availableBalanceFen",1000000);}
            };
            Tool generated=components.wrap(transport,events::add);
            assertThat(generated.invoke(Map.of("accountId","A1001"),Map.of())).isEqualTo(Map.of("availableBalanceFen",1000000));
            assertThat(calls.get()).isEqualTo(1);
            assertThat(components.manifest()).containsEntry("operationId","getAccountBalance");
            var rail=new ManagedSkillRail(components,events::add);rail.reloadSkills();
            assertThat(((ToolOutput)rail.managedTool().invoke(Map.of("skill_name","balance-query"))).getData().toString()).contains("get_account_balance");
            assertThat(events).anySatisfy(event->assertThat(event).containsEntry("event","skill_loaded").containsEntry("skill","balance-query"));
        }
    }
    @Test void loadsActualGeneratedClassPreservesTrustedContextAndRecordsItsInvocation() throws Exception {
        try(var loader=component()) {
            var components=GeneratedComponents.load(loader,directory.resolve("workspace"),SPEC);assertThat(components.enabled()).isTrue();
            AtomicInteger calls=new AtomicInteger();List<Map<String,Object>> events=new ArrayList<>();
            Tool transport=new Tool(new ToolCard("equipment@1","get_equipment","fixture",Map.of())) {
                protected Object invokeInternal(Map<String,Object> inputs,Map<String,Object> kwargs){calls.incrementAndGet();assertThat(inputs).containsEntry("equipmentId","PUMP-001");assertThat(kwargs).containsEntry("trusted","runtime-context");return Map.of("temperatureCelsius",86);}
            };
            Tool generated=components.wrap(transport,events::add);assertThat(generated.invoke(Map.of("equipmentId","PUMP-001"),Map.of("trusted","runtime-context"))).isEqualTo(Map.of("temperatureCelsius",86));assertThat(calls.get()).isEqualTo(1);
            assertThat(events).anySatisfy(event->assertThat(event).containsEntry("event","generated_tool_invoked").containsEntry("className","generated.EquipmentTool").containsEntry("componentDigest","d".repeat(64)));
            assertThat(components.manifest()).containsEntry("specDigest",SPEC);assertThat(Files.readString(directory.resolve("workspace/skills/equipment-query/SKILL.md"))).contains("Use get_equipment");
        }
    }
    @Test void refusesWrongTargetAndModifiedClassOrSkillBeforeExecutingGeneratedCode() throws Exception {
        try(var loader=component()) {
            assertThatThrownBy(()->GeneratedComponents.load(loader,directory.resolve("wrong"),"e".repeat(64))).hasMessage("GENERATED_SPEC_MISMATCH");
            Path skill=directory.resolve("classes/skills/equipment-query/SKILL.md");byte[] original=Files.readAllBytes(skill);Files.writeString(skill,"tampered");
            assertThatThrownBy(()->GeneratedComponents.load(loader,directory.resolve("wrong"),SPEC)).hasMessage("GENERATED_SKILL_MISMATCH");Files.write(skill,original);
            Files.write(directory.resolve("classes/generated/EquipmentTool.class"),new byte[]{1,2,3});
            assertThatThrownBy(()->GeneratedComponents.load(loader,directory.resolve("wrong"),SPEC)).hasMessage("GENERATED_CLASS_MISMATCH");
        }
        assertThat(GeneratedComponents.load(Tool.class.getClassLoader(),directory.resolve("none"),SPEC).enabled()).isFalse();
    }
    @Test void sdkSkillReaderRejectsOtherPathsAndChangedMarkdown() throws Exception {
        try(var loader=component()) {
            var components=GeneratedComponents.load(loader,directory.resolve("workspace"),SPEC);
            List<Map<String,Object>> events=new ArrayList<>();
            var rail=new ManagedSkillRail(components,events::add);rail.reloadSkills();var tool=rail.managedTool();
            assertThat(((ToolOutput)tool.invoke(Map.of("skill_name","equipment-query"))).getData().toString()).contains("Use get_equipment");
            for(var input:List.of(Map.of("skill_name","other"),Map.of("skill_name","equipment-query","relative_file_path","../../secret.txt"),Map.of("skill_name","equipment-query","extra","value")))
                assertThatThrownBy(()->tool.invoke(new java.util.HashMap<>(input))).hasMessage("SKILL_READ_NOT_ALLOWED");
            assertThat(events).hasSize(1);
            Files.writeString(directory.resolve("workspace/skills/equipment-query/SKILL.md"),"tampered");
            assertThatThrownBy(()->tool.invoke(Map.of("skill_name","equipment-query"))).hasMessage("GENERATED_SKILL_MISMATCH");
            assertThatThrownBy(rail::reloadSkills).hasMessage("GENERATED_SKILL_MISMATCH");
            assertThat(events).hasSize(1);
        }
    }
    @Test void actualCoreLoopReadsSdkSkillThenInvokesGeneratedToolWithSameSession() throws Exception {
        try(var loader=component()) {
            var workspace=directory.resolve("workspace");var components=GeneratedComponents.load(loader,workspace,SPEC);
            AtomicInteger modelCalls=new AtomicInteger(), toolCalls=new AtomicInteger();List<Map<String,Object>> events=new java.util.concurrent.CopyOnWriteArrayList<>();
            var model=new Model((messages,config,client,options)->{
                int n=modelCalls.getAndIncrement();
                if(n==0) assertThat(messages.toString()).contains("equipment-query");
                return CompletableFuture.completedFuture(n<2?AssistantMessage.builder().content("").toolCalls(List.of(ToolCall.builder().id("generated-call-"+n)
                        .name(n==0?"skill_tool":"get_equipment").arguments(n==0?"{\"skill_name\":\"equipment-query\"}":"{\"equipmentId\":\"PUMP-001\"}").build())).build():new AssistantMessage("generated query complete"));
            });
            Tool transport=new Tool(new ToolCard("equipment@1","get_equipment","fixture",Map.of("type","object","properties",Map.of("equipmentId",Map.of("type","string"))))) {
                protected Object invokeInternal(Map<String,Object> inputs,Map<String,Object> kwargs){toolCalls.incrementAndGet();assertThat(GeneratedComponents.sessionId(kwargs)).isEqualTo("generated-session");return Map.of("status","warning");}
            };
            var agent=new AgentAssembler().assemble(new AgentSpec("generated-loop","DeepAgent","Read the equipment-query Skill then query PUMP-001.",4,List.of("audit","tool-allowlist")),workspace,model,List.of(components.wrap(transport,events::add)),events::add,new SessionExecutions(),components);
            try {
                assertThat(agent.invoke(Map.of("query","Query PUMP-001","conversation_id","generated-session")).toString()).contains("generated query complete");
                assertThat(toolCalls.get()).isEqualTo(1);
                assertThat(events).anySatisfy(e->assertThat(e).containsEntry("event","skill_loaded").containsEntry("sessionId","generated-session"));
                assertThat(events).anySatisfy(e->assertThat(e).containsEntry("event","generated_tool_invoked").containsEntry("sessionId","generated-session"));
                for(String name:List.of("bash","code","read_file","list_skill_tool")) assertThat(agent.getAgent().getAbilityManager().get(name)).isEmpty();
            } finally {agent.destroy();}
        }
    }
}
