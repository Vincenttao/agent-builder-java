package com.openjiuwen.workbench.runtime;

import com.moaagent.agent.support.Json;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.runner.Runner;
import com.openjiuwen.service.spec.dto.*;
import com.openjiuwen.service.spec.spi.*;
import java.nio.file.Path;
import java.util.*;

/** Low-level Skill execution endpoint. Business task routing is supplied by the application host separately. */
public final class SkillExecutionService implements AgentHandler {
    private record Running(String skillId,MoaExecution execution){}
    private final BusinessAssets assets;private final Model model;private final Path state;
    private final Map<String,Running> executions=new LinkedHashMap<>();
    private final Map<String,MoaExecution.Turn> turns=new LinkedHashMap<>();
    public SkillExecutionService(BusinessAssets assets,Model model,Path state){this.assets=assets;this.model=model;this.state=state;}
    @Override public void start(){Runner.start().toCompletableFuture().join();}
    @Override public synchronized void stop(){for(var run:executions.values())run.execution.close();executions.clear();Runner.stop().toCompletableFuture().join();}
    public synchronized Map<String,Object> turn(String conversation,String skill,String query,String interrupt,Object answer){
        String id=conversation==null||conversation.isBlank()?UUID.randomUUID().toString():conversation;
        if(!id.matches("[a-zA-Z0-9_-]{1,100}"))throw new IllegalArgumentException("INVALID_EXECUTION_ID");
        Running running=executions.get(id);MoaExecution.Turn result;
        if(interrupt!=null){
            if(running==null)throw new IllegalStateException("EXECUTION_NOT_FOUND");
            result=running.execution.reply(interrupt,answer);
        }else{
            if(running!=null)throw new IllegalStateException("USE_ORIGINAL_INTERRUPT_OR_NEW_EXECUTION");
            if(executions.size()>=128)throw new IllegalStateException("EXECUTION_RETENTION_LIMIT");
            if(query==null||query.isBlank()||query.length()>12000)throw new IllegalArgumentException("QUERY_REQUIRED");
            var entry=assets.skill(skill);
            var execution=new MoaExecution(id,state.resolve(id),entry.assets(),entry.operations(),model,assets.scripts(skill),assets.instructions());
            running=new Running(skill,execution);executions.put(id,running);result=execution.invoke(query);
        }
        turns.put(id,result);return view(id);
    }
    public synchronized Map<String,Object> view(String id){
        var running=executions.get(id);var result=turns.get(id);if(running==null||result==null)throw new IllegalArgumentException("EXECUTION_NOT_FOUND");
        var view=new LinkedHashMap<String,Object>();view.put("executionId",id);view.put("skillId",running.skillId);view.put("result",result.result());view.put("interrupt",result.interrupt());view.put("traceId",result.traceId());view.put("events",running.execution.events());return view;
    }
    @Override public QueryResponse query(ServeRequest request){
        String id=request.getConversationId();String skill=Objects.toString(request.getMetadata().get("workbench.skillId"),assets.skillIds().stream().sorted().findFirst().orElse(""));
        Map<String,Object> replies=Json.object(request.getMetadata().get("runtime.remoteToolResults"));
        if(replies.size()>1)throw new IllegalArgumentException("ONE_REPLY_PER_EXECUTION");
        String interrupt=replies.keySet().stream().findFirst().orElse(null);
        var view=turn(id,skill,request.lastUserQuery(),interrupt,interrupt==null?null:replies.get(interrupt));
        return new QueryResponse(view,view.get("executionId").toString());
    }
    @Override public void streamQuery(ServeRequest request,QueryStreamObserver observer){try{observer.onComplete(query(request));}catch(RuntimeException failure){observer.onError(failure);}}
}
