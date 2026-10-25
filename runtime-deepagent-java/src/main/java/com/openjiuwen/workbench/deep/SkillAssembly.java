package com.openjiuwen.workbench.deep;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.openjiuwen.core.foundation.tool.ToolCard;
import com.openjiuwen.core.foundation.tool.function.LocalFunction;
import java.nio.file.*;
import java.util.*;
/** Adapts saved workbench Skill declarations to a bounded DeepAgent skill_tool. */
public final class SkillAssembly {
 public record Skill(String id,String content,Set<String> operations){}
 private final Map<String,Skill> skills;
 public SkillAssembly(Map<String,Skill> skills){this.skills=Map.copyOf(skills);}
 @SuppressWarnings("unchecked") public static SkillAssembly load(Path app){try{
  var json=new ObjectMapper();Map<String,Object> def=json.readValue(Files.readString(app.resolve("application.json")),new TypeReference<>(){});var selected=(List<Map<String,Object>>)def.get("skills");Map<String,Object> catalog=json.readValue(Files.readString(app.resolve("adapters/operations.json")),new TypeReference<>(){});Map<String,Skill> result=new LinkedHashMap<>();Path root=app.toRealPath();
  if(Boolean.TRUE.equals(((Map<?,?>)def.get("handoff")).get("enabled"))||!((List<?>)def.get("capabilities")).isEmpty())throw new IllegalArgumentException("UNSUPPORTED_ASSEMBLY");
  for(var s:selected){String id=(String)s.get("id"),file=(String)s.get("file");Path path=root.resolve(file).normalize();if(!path.startsWith(root.resolve("skills"))||!path.toRealPath().startsWith(root.resolve("skills"))||Files.isSymbolicLink(path)||Files.size(path)>50000)throw new IllegalArgumentException("INVALID_SKILL_PATH");Set<String> operations=new LinkedHashSet<>((List<String>)s.get("operations"));if(operations.isEmpty()||!Set.of("read_file","write_file","list_files","replace_text").containsAll(operations)||operations.stream().anyMatch(n->!(catalog.get(n) instanceof Map<?,?> op)||!"CORE".equals(op.get("type"))||!n.equals(op.get("nativeTool"))))throw new IllegalArgumentException("UNSUPPORTED_ASSEMBLY");result.put(id,new Skill(id,Files.readString(path),operations));}
  return new SkillAssembly(result);
 }catch(java.io.IOException e){throw new IllegalArgumentException("INVALID_ASSEMBLY");}}
 public List<Object> tools(ArtifactTools files){files.requireSelection(true);String prefix=UUID.randomUUID().toString();
  return List.of(new LocalFunction(ToolCard.builder().id(prefix+"-skill").name("skill_tool").description("先读取当前业务适用的已装配Skill，再使用该Skill允许的工具。Skill名单："+String.join(",",skills.keySet())).inputParams(Map.of("type","object","properties",Map.of("skill_name",Map.of("type","string")),"required",List.of("skill_name"),"additionalProperties",false)).build(),args->{var skill=skills.get(String.valueOf(args.get("skill_name")));if(skill==null)return Map.of("success",false,"error","SKILL_NOT_ASSEMBLED");files.selectSkill(skill.id(),skill.operations());return Map.of("success",true,"skill_name",skill.id(),"skill_content",skill.content(),"allowed_operations",skill.operations());}),
   new LocalFunction(ToolCard.builder().id(prefix+"-list-skills").name("list_skills").description("列出当前应用已装配的业务Skills，不包括模板开发Skill").inputParams(Map.of("type","object","properties",Map.of())).build(),args->Map.of("skills",skills.values().stream().map(s->Map.of("id",s.id(),"operations",s.operations())).toList())));
 }
}
