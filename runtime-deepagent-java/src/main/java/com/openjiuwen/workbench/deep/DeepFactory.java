package com.openjiuwen.workbench.deep;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.openjiuwen.core.session.AgentSession;
import com.openjiuwen.core.singleagent.schema.AgentCard;
import com.openjiuwen.harness.factory.HarnessFactory;
import com.openjiuwen.harness.rails.TaskCompletionRail;
import com.openjiuwen.harness.schema.config.DeepAgentConfig;
import com.openjiuwen.harness.workspace.Workspace;
import com.openjiuwen.service.adapters.agentcore.agentfw.JiuwenCoreAgentHandler;
import com.openjiuwen.service.spec.dto.ServeRequest;
import java.nio.file.Path;
import java.time.Duration;
import java.util.*;
public final class DeepFactory {
 private static final ObjectMapper JSON=new ObjectMapper();
 public static DeepHost.Executor create(String id,Path workspace,String instructions,ModelConfiguration model,ArtifactTools tools){
  return create(id,workspace,instructions,model,tools,List.of());
 }
 public static DeepHost.Executor create(String id,Path workspace,String instructions,ModelConfiguration model,ArtifactTools tools,List<Object> skillTools){
  var all=new ArrayList<Object>(tools.tools());all.addAll(skillTools);
  var completion=new TaskCompletionRail("完成当前用户目标并维护brief.md。写后必须read_file核对。当前请求：{query}","ARTIFACTS_READY",1,false,3,180.0,List.of());
  var config=DeepAgentConfig.builder().systemPrompt(instructions).maxIterations(8).enableTaskLoop(true).completionTimeout(180.0).workspacePath(workspace.toString()).language("cn").restrictToWorkDir(true).tools(all).rails(List.of(completion))
   .permissions(Map.of("defaults",Map.of("*","deny"),"tools",Map.of("read_file","allow","write_file","allow","list_files","allow","skill_tool","allow","list_skills","allow")))
   .model(Map.of("model",model.model(),"temperature",0.1)).backend(Map.of("provider","OpenAI","api_key",model.apiKey(),"api_base",model.baseUrl(),"verify_ssl",true,"timeout",45L)).build();
  var agent=HarnessFactory.createDeepAgent(AgentCard.builder().id("deep-"+id).name("independent-business").description("按装配Skill完成独立业务目标").build(),config,Workspace.builder().rootPath(workspace.toString()).language("cn").build());
  agent.ensureInitialized();var session=new AgentSession(id,new LinkedHashMap<>(),null);
  var handler=new JiuwenCoreAgentHandler(agent){@Override protected Object runnerSession(ServeRequest request){return session;}};
  return new DeepHost.Executor(){public Map<String,Object> invoke(String query){var request=new ServeRequest();request.setConversationId(id);request.setStream(false);request.setMessages(List.of(Map.of("role","user","content",query)));Object result=handler.query(request).getResult();try{return result instanceof String text?JSON.readValue(text,new TypeReference<>(){}):JSON.convertValue(result,new TypeReference<>(){});}catch(Exception e){throw new IllegalStateException("INVALID_AGENT_RESULT");}}public void close(){agent.close();}};
 }
}
