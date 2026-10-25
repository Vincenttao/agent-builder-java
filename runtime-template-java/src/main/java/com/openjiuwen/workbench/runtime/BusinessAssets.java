package com.openjiuwen.workbench.runtime;

import com.fasterxml.jackson.core.type.TypeReference;
import com.moaagent.agent.skill.*;
import com.moaagent.agent.support.Json;
import java.net.URI;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;

/** Loads one immutable application directory. Runtime references must be valid even if a draft could be saved. */
public final class BusinessAssets {
    public record Entry(SkillAssets assets,Map<String,SkillOperation> operations){}
    private final Path root;
    private final Map<String,Object> definition;
    private final Map<String,Entry> entries=new LinkedHashMap<>();
    private final Map<String,String> targets=new LinkedHashMap<>();
    private final Map<String,Object> configuration;
    private final String instructions;

    public BusinessAssets(Path directory){
        try {
            root=directory.toRealPath();definition=Json.MAPPER.readValue(read("application.json"),new TypeReference<>(){});
            if(!Integer.valueOf(1).equals(definition.get("schemaVersion")))throw invalid("schemaVersion");
            text(definition.get("name"));instructions=read("instructions.md");if(instructions.isBlank())throw invalid("instructions.md");
            Map<String,Object> connections=map(definition.get("connections"));
            for(var value:connections.values())validateUrl(text(value));
            var mapping=map(definition.get("mapping"));if(!text(mapping.get("balancePath")).matches("[A-Za-z][A-Za-z0-9_.]*"))throw invalid("mapping.balancePath");
            configuration=Map.of("connections",connections,"mapping",mapping);
            for(Object item:list(definition.get("capabilities"))){
                var capability=map(item);if(!"agent".equals(capability.get("type")))continue;
                String id=text(capability.get("id"));if(!id.matches("[a-z][a-z0-9-]{0,63}")||targets.containsKey(id))throw invalid("capability.id");
                String connection=text(capability.get("connection"));targets.put(id,text(connections.get(connection)));
            }
            var handoff=map(definition.get("handoff"));
            if(!Integer.valueOf(2).equals(handoff.get("maxTasks"))||!Set.of("ask","retain","discard").contains(handoff.get("unfinished"))||!Set.of("prompt","auto").contains(handoff.get("resume")))throw invalid("handoff policy");
            if(Boolean.TRUE.equals(handoff.get("enabled"))&&!targets.containsKey(handoff.get("target")))throw invalid("handoff.target");
            List<?> skills=list(definition.get("skills"));if(skills.size()>30)throw invalid("skills limit");
            Map<String,SkillOperation> catalog=skills.isEmpty()?Map.of():Json.MAPPER.readValue(read("adapters/operations.json"),new TypeReference<>(){});
            for(Object item:skills){
                var skill=map(item);String id=text(skill.get("id"));
                if(!id.matches("[a-z][a-z0-9-]{0,63}")||entries.containsKey(id)||!("skills/"+id+"/SKILL.md").equals(skill.get("file")))throw invalid("skill reference");
                read(text(skill.get("file")));var assets=new SkillAssets(root.resolve("skills").toString(),id);
                Map<String,SkillOperation> selected=new LinkedHashMap<>();
                for(Object name:list(skill.get("operations"))){
                    String operation=text(name);var declared=catalog.get(operation);if(declared==null||selected.containsKey(operation))throw invalid("operation reference");
                    declared=declared.resolveContract(assets);
                    if(operation.equals("redeem")&&(!declared.confirmationRequired()||!"demo".equals(declared.fixedArguments().get("employeeId"))))throw invalid("fixed redemption policy");
                    if(Set.of("transfer","purchase").contains(operation)&&(!declared.confirmationRequired()||!"demo".equals(declared.fixedArguments().get("customerId"))))throw invalid("fixed money operation policy");
                    if(declared.resultScript()!=null)assets.script(declared.resultScript());if(declared.beforeScript()!=null)assets.script(declared.beforeScript());
                    selected.put(operation,declared);
                }
                if(selected.isEmpty())throw invalid("empty skill operations");
                entries.put(id,new Entry(assets,Map.copyOf(selected)));
            }
        }catch(IllegalArgumentException e){throw e;}catch(Exception e){throw new IllegalArgumentException("APPLICATION_ASSETS_INVALID",e);}
    }
    public Entry skill(String id){var entry=entries.get(id);if(entry==null)throw invalid("skill not mounted");return entry;}
    public Set<String> skillIds(){return Set.copyOf(entries.keySet());}
    public Map<String,String> agentTargets(){return Map.copyOf(targets);}
    public Map<String,Object> definition(){return Json.object(definition);}
    public String instructions(){return instructions;}
    public Path root(){return root;}
    public SkillScriptRunner scripts(String id){
        var entry=skill(id);Set<String> registered=new HashSet<>();
        for(var op:entry.operations.values()){if(op.resultScript()!=null)registered.add(entry.assets.script(op.resultScript()));if(op.beforeScript()!=null)registered.add(entry.assets.script(op.beforeScript()));}
        var local=new LocalSkillRunner(registered,Duration.ofSeconds(5),65536);
        return (session,source,input)->{var enriched=new LinkedHashMap<>(input);enriched.put("configuration",configuration);return local.run(session,source,enriched);};
    }
    public String read(String relative){
        try{Path path=root.resolve(relative).normalize();if(!path.startsWith(root)||!path.toRealPath().startsWith(root)||!Files.isRegularFile(path)||Files.size(path)>2_000_000)throw invalid("asset path");return Files.readString(path);}catch(IllegalArgumentException e){throw e;}catch(Exception e){throw invalid("missing asset "+relative);}
    }
    private static Map<String,Object> map(Object value){if(!(value instanceof Map<?,?>))throw invalid("object expected");return Json.object(value);}
    private static List<?> list(Object value){if(!(value instanceof List<?> values))throw invalid("list expected");return values;}
    private static String text(Object value){if(!(value instanceof String s)||s.isBlank()||s.length()>12000)throw invalid("text expected");return s;}
    private static void validateUrl(String value){URI uri=URI.create(value);if(!Set.of("http","https").contains(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null)throw invalid("connection URL");}
    private static IllegalArgumentException invalid(String field){return new IllegalArgumentException("APPLICATION_ASSETS_INVALID: "+field);}
}
