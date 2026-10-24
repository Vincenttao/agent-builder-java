package com.openjiuwen.workbench.runtime;

import com.moaagent.agent.skill.*;
import com.moaagent.agent.support.Json;
import com.moaagent.agent.interaction.narration.*;
import com.moaagent.agent.routing.context.DefaultModelContextContributor;
import com.moaagent.compat.DeepSessionOtelRail;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.session.AgentSession;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.harness.deep_agent.DeepAgent;
import com.openjiuwen.service.adapters.agentcore.agentfw.JiuwenCoreAgentHandler;
import com.openjiuwen.service.spec.dto.ServeRequest;
import java.nio.file.Path;
import java.util.*;

/** One business Skill execution, through Runtime's Core adapter and the actual MOA tool loop. */
public final class MoaExecution implements AutoCloseable {
    public record Interrupt(String id,String message,String tool,Map<String,Object> context){}
    public record Turn(Map<String,Object> result,Interrupt interrupt,String traceId){}
    private final DeepAgent agent;
    private final JiuwenCoreAgentHandler handler;
    private final AgentSession session;
    private final List<Map<String,Object>> events=new ArrayList<>();
    private java.util.function.Consumer<Map<String,Object>> listener=event->{};
    private volatile io.opentelemetry.context.Context invocationParent=io.opentelemetry.context.Context.root();
    private Interrupt pending;private String traceId;private boolean closed,ended;

    public MoaExecution(String id,Path workspace,SkillAssets assets,Map<String,SkillOperation> operations,
            Model model,SkillScriptRunner scripts,String instructions){
        this(new AgentSession(id,new LinkedHashMap<>(),null),workspace,assets,operations,model,scripts,instructions);
    }
    public MoaExecution(AgentSession session,Path workspace,SkillAssets assets,Map<String,SkillOperation> operations,
            Model model,SkillScriptRunner scripts,String instructions){
        this.session=session;
        var otel=new DeepSessionOtelRail(){
            @Override public void beforeInvoke(AgentCallbackContext ctx){
                var inherited=invocationParent.makeCurrent();ctx.getExtra().put("workbench.parent_scope",inherited);
                try{super.beforeInvoke(ctx);var span=io.opentelemetry.api.trace.Span.current().getSpanContext();traceId=span.isValid()?span.getTraceId():null;}
                catch(RuntimeException|Error error){ctx.getExtra().remove("workbench.parent_scope");inherited.close();throw error;}
            }
            @Override public void afterInvoke(AgentCallbackContext ctx){
                try{super.afterInvoke(ctx);}finally{var inherited=ctx.getExtra().remove("workbench.parent_scope");if(inherited instanceof io.opentelemetry.context.Scope scope)scope.close();}
            }
        };
        NarrationOutput output=(s,event,payload)->{var record=Map.<String,Object>of("type",event.name(),"payload",Json.object(payload));if(events.size()<4096)events.add(record);listener.accept(record);};
        var services=new NativeSkillAgent.ExecutionServices(scripts,ProgressNarrationCoordinator.disabled(),output,List.of(),new DefaultModelContextContributor(),List.of(role->List.of(otel)));
        String system=com.moaagent.agent.support.PromptTemplates.defaultPrompt("native-skill")+"\n应用指令：\n"+instructions;
        agent=NativeSkillAgent.create(new NativeSkillAgent.Settings("business-"+session.getSessionId(),workspace.toString(),12,system),model,assets,operations,services);
        agent.getConfig().setTodoStorageType("file");
        handler=new JiuwenCoreAgentHandler(agent){@Override protected Object runnerSession(ServeRequest request){return MoaExecution.this.session;}};
    }
    public synchronized Turn invoke(String query){
        if(closed||ended||pending!=null)throw new IllegalStateException("SKILL_NOT_READY_FOR_NEW_QUERY");
        var request=request();request.setMessages(List.of(Map.of("role","user","content",query)));return execute(request);
    }
    public synchronized Turn reply(String id,Object response){
        if(closed||ended||pending==null||!pending.id().equals(id))throw new IllegalStateException("STALE_SKILL_REPLY");
        var request=request();request.setMetadata(Map.of("runtime.remoteToolResults",Map.of(id,response)));return execute(request);
    }
    private ServeRequest request(){var request=new ServeRequest();request.setConversationId(session.getSessionId());request.setStream(false);return request;}
    private Turn execute(ServeRequest request){
        invocationParent=io.opentelemetry.context.Context.current();
        Map<String,Object> result=Json.object(handler.query(request).getResult());
        Map<String,Object> interruption=Json.object(result.get("_interrupt"));
        if(!interruption.isEmpty()){
            Map<String,Object> context=Json.object(interruption.get("context"));
            String id=Objects.toString(interruption.getOrDefault("toolCallId",context.get("tool_call_id")),"");
            String tool=Objects.toString(interruption.getOrDefault("toolName",context.get("tool_name")),"");
            if(id.isBlank())throw new IllegalStateException("UNSUPPORTED_INTERRUPT_WITHOUT_CORRELATION");
            pending=new Interrupt(id,Objects.toString(interruption.get("message"),"等待补充"),tool,context);
        }else{pending=null;ended=true;}
        return new Turn(result,pending,traceId);
    }
    public void onEvent(java.util.function.Consumer<Map<String,Object>> listener){this.listener=java.util.Objects.requireNonNull(listener);}
    public synchronized List<Map<String,Object>> events(){return List.copyOf(events);}
    public AgentSession session(){return session;}
    public synchronized void close(){if(!closed){closed=true;agent.close();}}
}
