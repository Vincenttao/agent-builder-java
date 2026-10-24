package com.openjiuwen.workbench.runtime;

import com.moaagent.agent.skill.*;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.runner.Runner;
import com.openjiuwen.service.spec.dto.*;
import com.openjiuwen.service.spec.spi.*;
import com.openjiuwen.service.app.controller.a2a.A2aPartContent;
import org.a2aproject.sdk.spec.Task;
import org.a2aproject.sdk.spec.TaskState;
import io.opentelemetry.api.trace.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.locks.ReentrantLock;

/** Application-owned same-process task host. Core retains Skill waits; SDK retains remote task/context. */
public final class BusinessHost implements AgentHandler {
    public record Prompt(String token,String kind,String message,long expiresAt){}
    public record TaskView(String id,String target,String kind,String query,TaskShelf.State state,Prompt prompt,
            Map<String,Object> output,String error,List<String> traceIds){}
    public record SwitchRequest(String requestId,String target,String query){}
    public record View(String conversationId,boolean busy,TaskShelf.Snapshot stack,List<TaskView> tasks,
            List<Map<String,Object>> events,SwitchRequest switchRequest,String clarification,boolean conflict){}
    private static final class Frame {
        final String id,target,kind,query;final List<String> traceIds=new ArrayList<>();
        MoaExecution execution;MoaExecution.Turn turn;Prompt prompt;Task remote;
        String callKey,writeOperation,error="";Map<String,Object> writeArguments=Map.of(),output=Map.of();
        Frame(String id,String target,String kind,String query){this.id=id;this.target=target;this.kind=kind;this.query=query;}
    }
    private static final class Conversation {
        final String id;final TaskShelf shelf;final Path journal;final ReentrantLock lock=new ReentrantLock(true);
        final Map<String,Frame> frames=new LinkedHashMap<>();final List<Map<String,Object>> events=new ArrayList<>();
        volatile View published;boolean busy,conflict;String clarification="";SwitchRequest switching;long sequence,shelfSequence;
        Conversation(String id,Set<String> targets,Path state){this.id=id;shelf=new TaskShelf(targets);journal=state.resolve(id).resolve("events.jsonl");}
    }
    private final BusinessAssets assets;private final LlmRouter router;private final Model skillModel;
    private final ControlledA2aClient remote;private final Path state;private final Tracer tracer;
    private final Map<String,Conversation> conversations=new ConcurrentHashMap<>();
    private final Map<String,String> externalConversations=new ConcurrentHashMap<>();private volatile boolean stopped,definitionConflict;
    public BusinessHost(BusinessAssets assets,Model routeModel,Model skillModel,Path state){this(assets,routeModel,skillModel,state,io.opentelemetry.api.OpenTelemetry.noop().getTracer("workbench"));}
    public BusinessHost(BusinessAssets assets,Model routeModel,Model skillModel,Path state,Tracer tracer){
        this.assets=assets;router=new LlmRouter(assets,routeModel);this.skillModel=skillModel;this.state=state;this.tracer=tracer;remote=new ControlledA2aClient(assets.agentTargets());
        Set<String> overlap=new HashSet<>(assets.skillIds());overlap.retainAll(assets.agentTargets().keySet());if(!overlap.isEmpty())throw new IllegalArgumentException("DUPLICATE_CAPABILITY_ID");
    }
    @Override public void start(){Runner.start().toCompletableFuture().join();}
    @Override public synchronized void stop(){if(stopped)return;stopped=true;for(var c:conversations.values())for(var f:c.frames.values())if(f.execution!=null)f.execution.close();remote.close();Runner.stop().toCompletableFuture().join();}
    private synchronized Conversation create(){
        if(stopped)throw error("APPLICATION_STOPPED");if(conversations.size()>=64)throw error("CONVERSATION_RETENTION_LIMIT");
        Set<String> targets=new HashSet<>(assets.skillIds());targets.addAll(assets.agentTargets().keySet());
        var c=new Conversation(UUID.randomUUID().toString(),targets,state);conversations.put(c.id,c);publish(c);return c;
    }
    private Conversation get(String id){if(id==null)throw error("CONVERSATION_NOT_FOUND");var c=conversations.get(id);if(c==null)throw error("CONVERSATION_NOT_FOUND");return c;}
    public View reserve(){return create().published;}
    public View view(String id){return get(id).published;}
    public View message(String id,String query){
        Conversation c=id==null||id.isBlank()?create():get(id);
        return command(c,"message",()->{
            if(c.switching!=null)throw error("SWITCH_DECISION_PENDING");
            if(c.conflict)throw error("DEFINITION_CONFLICT_REQUIRES_CODING");
            var current=c.shelf.snapshot().current();Frame frame=current!=null&&!ended(current.state())?c.frames.get(current.id()):null;
            emit(c,"user_message",frame==null?"":frame.id,Map.of("text",Objects.toString(query,"")));
            emit(c,"routing_started",frame==null?"":frame.id,Map.of());publish(c);
            LlmRouter.Decision decision;
            var span=tracer.spanBuilder("route.llm").startSpan();try(var scope=span.makeCurrent()){
                decision=router.decide(query,frame==null?null:frame.id,frame==null?null:frame.target,frame==null||frame.prompt==null?null:frame.prompt.message);
                span.setAttribute("route.action",decision.action().name());span.setAttribute("route.target",decision.target());
            }finally{span.end();}
            emit(c,"routing_decided",frame==null?"":frame.id,Json.object(decision));c.clarification="";
            if(decision.action()==LlmRouter.Action.CLARIFY){c.clarification=decision.question();return;}
            if(decision.action()==LlmRouter.Action.CONFLICT){c.conflict=true;definitionConflict=true;c.clarification=decision.reason();return;}
            if(decision.action()==LlmRouter.Action.CONTINUE){if(frame==null||frame.prompt==null)throw error("NO_WAITING_INPUT");replyInternal(c,frame,frame.prompt.token,query);return;}
            if(frame==null){String task=c.shelf.start(decision.target());activate(c,task,decision.target(),query);return;}
            var policy=TaskShelf.Policy.valueOf(policy().get("unfinished").toString().toUpperCase(Locale.ROOT));
            String request=c.shelf.requestSwitch(decision.target(),policy);
            if(policy==TaskShelf.Policy.ASK){c.switching=new SwitchRequest(request,decision.target(),query);publish(c);return;}
            activate(c,c.shelf.snapshot().current().id(),decision.target(),query);
        });
    }
    public View decide(String id,String request,String choice){var c=get(id);return command(c,"switch_decision",()->{
        if(c.switching==null||!c.switching.requestId.equals(request))throw error("STALE_SWITCH_DECISION");
        var switching=c.switching;var decision=TaskShelf.Decision.valueOf(Objects.toString(choice,""));c.shelf.decide(request,decision);c.switching=null;
        if(decision!=TaskShelf.Decision.STAY)activate(c,c.shelf.snapshot().current().id(),switching.target,switching.query);
    });}
    public View reply(String id,String task,String token,String answer){var c=get(id);return command(c,"reply",()->replyInternal(c,frame(c,task),token,answer));}
    private void replyInternal(Conversation c,Frame frame,String token,String answer){
        c.shelf.checkInput(frame.id,token);
        if(frame.prompt==null||!frame.prompt.token.equals(token)||frame.prompt.expiresAt<System.currentTimeMillis())throw error("STALE_TASK_INPUT");
        boolean declined=frame.turn!=null&&frame.turn.interrupt()!=null&&frame.turn.interrupt().tool().equals("confirm_action")&&!com.moaagent.agent.interaction.ConfirmationResponses.approved(answer);
        c.shelf.inputAccepted(frame.id,token);frame.prompt=null;recordTrace(frame,Span.current().getSpanContext().getTraceId());publish(c);
        try{
            if(frame.execution!=null)settle(c,frame,frame.execution.reply(frame.turn.interrupt().id(),answer));
            else callRemote(c,frame,answer);
        }catch(RuntimeException failure){failed(c,frame,failure);}
        if(declined&&frame.callKey==null){frame.output=new LinkedHashMap<>(frame.output);frame.output.put("userDecision","rejected");emit(c,"confirmation_declined",frame.id,Map.of("message","用户拒绝，未提交兑换"));}
        maybeAutoResume(c);
    }
    private void activate(Conversation c,String id,String target,String query){
        for(var previous:c.shelf.snapshot().tasks())if(previous.state()==TaskShelf.State.ABANDONED){var old=c.frames.get(previous.id());if(old!=null&&old.execution!=null){old.execution.close();old.prompt=null;}}
        var frame=new Frame(id,target,assets.skillIds().contains(target)?"skill":"agent",query);c.frames.put(id,frame);recordTrace(frame,Span.current().getSpanContext().getTraceId());publish(c);
        try{
            if(frame.kind.equals("skill")){
                var entry=assets.skill(target);SkillScriptRunner scripts=assets.scripts(target);
                SkillScriptRunner guarded=(session,source,input)->{
                    var finisher=entry.operations().get("finish");
                    if(finisher!=null&&finisher.resultScript()!=null&&entry.assets().script(finisher.resultScript()).equals(source)){
                        var execution=SkillSession.load(session).orElseThrow(()->error("SKILL_STATE_MISSING"));
                        boolean verified=!execution.getResults().isEmpty();
                        boolean rejected=execution.getReceipts().values().stream().map(Json::object)
                                .anyMatch(receipt->"confirm_action".equals(receipt.get("tool"))&&Boolean.FALSE.equals(Json.object(receipt.get("response")).get("approved")));
                        if(!verified&&!rejected)throw error("VERIFIED_RESULT_REQUIRED");
                    }
                    String operation=entry.operations().entrySet().stream().filter(e->e.getValue().resultScript()!=null&&e.getValue().confirmationRequired()&&entry.assets().script(e.getValue().resultScript()).equals(source)).map(Map.Entry::getKey).findFirst().orElse(null);
                    if(operation==null)return scripts.run(session,source,input);
                    if(!operation.equals("redeem"))throw error("WRITE_ADAPTER_NOT_SUPPORTED");
                    String key="redeem-"+input.get("execution_id");c.shelf.submitted(frame.id,key);
                    frame.callKey=key;frame.writeOperation=operation;frame.writeArguments=Json.object(input.get("arguments"));
                    emit(c,"write_authorized",frame.id,Map.of("operation",frame.writeOperation,"arguments",frame.writeArguments,"idempotencyKey",frame.callKey,"parameterRevision",input.getOrDefault("revision",0)));publish(c);
                    Map<String,Object> result=scripts.run(session,source,input);var data=Json.object(result.get("data"));
                    SkillSchema.validate(entry.operations().get(operation).outputSchema(),data);
                    if(!frame.callKey.equals(data.get("idempotencyKey")))throw error("RECEIPT_CORRELATION_MISMATCH");
                    if("completed".equals(data.get("status")))c.shelf.receipt(frame.id,frame.callKey,true);
                    else if("failed".equals(data.get("status")))c.shelf.receipt(frame.id,frame.callKey,false);
                    frame.output=data;publish(c);return result;
                };
                frame.execution=new MoaExecution(c.shelf.session(id),state.resolve(c.id).resolve("core").resolve(id),entry.assets(),entry.operations(),skillModel,guarded,assets.instructions());
                frame.execution.onEvent(event->{emit(c,"skill."+event.get("type"),frame.id,Json.object(event.get("payload")));publish(c);});
                settle(c,frame,frame.execution.invoke(query));
            }else callRemote(c,frame,query);
        }catch(RuntimeException failure){failed(c,frame,failure);}
        maybeAutoResume(c);
    }
    private void settle(Conversation c,Frame frame,MoaExecution.Turn turn){
        frame.turn=turn;recordTrace(frame,turn.traceId());
        if(turn.interrupt()!=null){
            var interruption=turn.interrupt();
            if(Json.object(interruption.context()).containsKey("_interrupt_kind"))throw error("NESTED_REMOTE_SKILL_NOT_ENABLED");
            String message=interruption.message();if(interruption.tool().equals("confirm_action"))message+="\n业务主体：demo（本机 Mock 员工）";
            frame.prompt=prompt(interruption.tool(),message);c.shelf.waitForInput(frame.id,frame.prompt.token);
        }else{
            if(frame.callKey==null){frame.output=SkillOutput.result(turn.result());c.shelf.finish(frame.id,Boolean.TRUE.equals(frame.output.get("success")));}
            else if(frame.output.isEmpty())frame.output=Map.of("status","unknown","idempotencyKey",frame.callKey);
        }
        publish(c);
    }
    private void callRemote(Conversation c,Frame frame,String text){
        emit(c,"a2a_call_started",frame.id,Map.of("target",frame.target,"contextId",frame.id,"remoteTaskId",frame.remote==null?"":frame.remote.id()));publish(c);
        var span=tracer.spanBuilder("a2a."+frame.target).setAttribute("task.id",frame.id).startSpan();
        try(var scope=span.makeCurrent()){
            frame.remote=remote.send(frame.target,frame.id,frame.remote==null?null:frame.remote.id(),text);
            recordTrace(frame,span.getSpanContext().getTraceId());
        }finally{span.end();}
        var state=frame.remote.status().state();frame.output=Map.of("remoteTaskId",frame.remote.id(),"contextId",frame.remote.contextId(),"state",state.name(),"text",remoteText(frame.remote));
        emit(c,"a2a_response",frame.id,Map.of("state",state.name(),"remoteTaskId",frame.remote.id(),"contextId",frame.remote.contextId()));
        if(state.isInterrupted()){
            String question=remoteText(frame.remote);if(question.isBlank())question="下游 Agent 需要补充或确认";
            frame.prompt=prompt("a2a_input",question);c.shelf.waitForInput(frame.id,frame.prompt.token);
        }else c.shelf.finish(frame.id,state==TaskState.TASK_STATE_COMPLETED);
        publish(c);
    }
    public View resume(String id,String task){var c=get(id);return command(c,"resume",()->resumeInternal(c,task));}
    private void resumeInternal(Conversation c,String id){
        var current=c.shelf.snapshot().current();
        if(current!=null&&current.id().equals(id)&&current.state()==TaskShelf.State.WAITING_INPUT)c.shelf.requireReview(id);
        else if(current==null||!current.id().equals(id)||current.state()!=TaskShelf.State.NEEDS_REVIEW)c.shelf.resume(id);
        Frame frame=frame(c,id);frame.prompt=null;recordTrace(frame,Span.current().getSpanContext().getTraceId());publish(c);
        if(frame.callKey!=null){emit(c,"receipt_required",id,Map.of("idempotencyKey",frame.callKey));return;}
        if(frame.execution==null){c.shelf.review(id,true);frame.prompt=prompt("a2a_input",remoteText(frame.remote));c.shelf.waitForInput(id,frame.prompt.token);return;}
        if(frame.turn==null||frame.turn.interrupt()==null)throw error("RESUME_POINT_NOT_SUPPORTED");
        var confirmation=Json.object(frame.turn.interrupt().context().get("confirmation"));
        if(!confirmation.isEmpty()){
            if(!"redeem".equals(confirmation.get("operation")))throw error("RESUME_REVIEW_NOT_SUPPORTED");
            var entry=assets.skill(frame.target);var args=Json.object(confirmation.get("arguments"));args.putAll(entry.operations().get("redeem").fixedArguments());SkillSchema.validate(entry.operations().get("redeem").inputSchema(),args);
            Map<String,Object> balance=readOperation(c,frame,"balance",Map.of()),gifts=readOperation(c,frame,"gifts",Map.of());
            var available=balance.get("available");Object cost=null;
            if(gifts.get("gifts") instanceof List<?> catalog)for(Object item:catalog){var gift=Json.object(item);if(Objects.equals(gift.get("id"),args.get("giftId")))cost=gift.get("points");}
            boolean passed=available instanceof Number amount&&cost instanceof Number price&&args.get("quantity") instanceof Number quantity&&amount.longValue()>=price.longValue()*quantity.longValue();
            c.shelf.review(id,passed);emit(c,"resume_facts_checked",id,Map.of("passed",passed,"balance",balance,"arguments",args));
            if(!passed){frame.error="RESUME_FACTS_CHANGED";return;}
        }else c.shelf.review(id,true);
        frame.error="";frame.prompt=prompt(frame.turn.interrupt().tool(),"已复核，原确认失效。请重新确认或补充：\n"+frame.turn.interrupt().message());c.shelf.waitForInput(id,frame.prompt.token);publish(c);
    }
    public View receipt(String id,String task){var c=get(id);return command(c,"receipt",()->{
        var frame=frame(c,task);recordTrace(frame,Span.current().getSpanContext().getTraceId());if(frame.callKey==null)throw error("NO_SUBMITTED_OPERATION");
        var status=c.shelf.snapshot().tasks().stream().filter(t->t.id().equals(task)).findFirst().orElseThrow();if(ended(status.state()))return;
        var data=readOperation(c,frame,"receipt",Map.of("idempotencyKey",frame.callKey));
        if(!frame.callKey.equals(data.get("idempotencyKey")))throw error("RECEIPT_CORRELATION_MISMATCH");
        if("completed".equals(data.get("status")))c.shelf.receipt(task,frame.callKey,true);else if("failed".equals(data.get("status")))c.shelf.receipt(task,frame.callKey,false);
        frame.output=data;publish(c);
    });}
    private Map<String,Object> readOperation(Conversation c,Frame frame,String name,Map<String,Object> args){
        var entry=assets.skill(frame.target);var operation=entry.operations().get(name);
        if(operation==null||operation.type()!=SkillOperation.Type.SCRIPT||operation.confirmationRequired()||!Set.of("balance","gifts","receipt").contains(name))throw error("READ_ADAPTER_NOT_SUPPORTED");
        SkillSchema.validate(operation.inputSchema(),args);emit(c,"review_read_started",frame.id,Map.of("operation",name));publish(c);
        Map<String,Object> result=assets.scripts(frame.target).run(c.shelf.session(frame.id),entry.assets().script(operation.resultScript()),Map.of("arguments",args,"execution_id",frame.id,"results",Map.of(),"versions",Map.of(),"metadata",Map.of(),"result",Map.of(),"revision",0));
        var data=Json.object(result.get("data"));if(!Boolean.TRUE.equals(result.get("success")))throw error("BUSINESS_READ_FAILED");SkillSchema.validate(operation.outputSchema(),data);
        emit(c,"review_read_completed",frame.id,Map.of("operation",name,"data",data));return data;
    }
    private void maybeAutoResume(Conversation c){String id=c.shelf.snapshot().resumeCandidate();if(id!=null&&"auto".equals(policy().get("resume")))resumeInternal(c,id);}
    private Map<String,Object> policy(){return Json.object(assets.definition().get("handoff"));}
    private Prompt prompt(String kind,String message){return new Prompt(UUID.randomUUID().toString(),kind,message,System.currentTimeMillis()+600_000);}
    private Frame frame(Conversation c,String id){var frame=c.frames.get(id);if(frame==null)throw error("TASK_NOT_FOUND");return frame;}
    private void failed(Conversation c,Frame frame,RuntimeException failure){frame.error=code(failure);if(frame.callKey==null){var task=c.shelf.snapshot().tasks().stream().filter(t->t.id().equals(frame.id)).findFirst().orElseThrow();if(!ended(task.state()))c.shelf.finish(frame.id,false);}emit(c,"task_error",frame.id,Map.of("code",frame.error));publish(c);}
    private View command(Conversation c,String name,Runnable action){
        if(stopped)throw error("APPLICATION_STOPPED");if(c.lock.getQueueLength()>=4)throw error("CONVERSATION_BUSY");
        try{if(!c.lock.tryLock(60,TimeUnit.SECONDS))throw error("CONVERSATION_BUSY");}catch(InterruptedException e){Thread.currentThread().interrupt();throw error("COMMAND_CANCELLED");}
        var span=tracer.spanBuilder("business."+name).setAttribute("conversation.id",c.id).startSpan();
        try(var scope=span.makeCurrent()){c.busy=true;publish(c);if(definitionConflict&&!name.equals("receipt"))throw error("DEFINITION_CONFLICT_REQUIRES_CODING");action.run();
        }catch(RuntimeException e){span.setStatus(StatusCode.ERROR,code(e));emit(c,"command_rejected","",Map.of("command",name,"code",code(e)));throw e;
        }finally{c.busy=false;try{publish(c);}finally{span.end();c.lock.unlock();}}
        return c.published;
    }
    private void publish(Conversation c){
        for(var event:c.shelf.events())if(event.sequence()>c.shelfSequence){append(c,event.type(),event.taskId(),Json.object(event.details()));c.shelfSequence=event.sequence();}
        var snapshot=c.shelf.snapshot();List<TaskView> tasks=new ArrayList<>();
        for(var state:snapshot.tasks()){var frame=c.frames.get(state.id());if(frame==null)continue;boolean current=snapshot.current()!=null&&snapshot.current().id().equals(frame.id);tasks.add(new TaskView(frame.id,frame.target,frame.kind,frame.query,state.state(),current&&state.state()==TaskShelf.State.WAITING_INPUT?frame.prompt:null,Json.object(frame.output),frame.error,List.copyOf(frame.traceIds)));}
        c.published=new View(c.id,c.busy,snapshot,List.copyOf(tasks),List.copyOf(c.events),c.switching,c.clarification,c.conflict||definitionConflict);
    }
    private void emit(Conversation c,String type,String task,Map<String,Object> data){publish(c);append(c,type,task,data);}
    private void append(Conversation c,String type,String task,Map<String,Object> data){
        var event=new LinkedHashMap<String,Object>();event.put("sequence",++c.sequence);event.put("time",Instant.now().toString());event.put("type",type);event.put("taskId",task);event.put("data",data);var span=Span.current().getSpanContext();if(span.isValid())event.put("traceId",span.getTraceId());
        String line=Json.write(event);if(line.length()>65536){event.put("data",Map.of("message","EVENT_PAYLOAD_TOO_LARGE"));line=Json.write(event);}
        try{Files.createDirectories(c.journal.getParent());if(Files.exists(c.journal)&&Files.size(c.journal)>8_000_000)throw error("EVENT_JOURNAL_LIMIT");Files.writeString(c.journal,line+"\n",StandardOpenOption.CREATE,StandardOpenOption.APPEND);}catch(java.io.IOException e){throw error("EVENT_JOURNAL_UNAVAILABLE");}
        c.events.add(Collections.unmodifiableMap(Json.object(event)));if(c.events.size()>4096)c.events.remove(0);
    }
    private static void recordTrace(Frame frame,String id){if(id!=null&&!id.isBlank()&&!id.equals("00000000000000000000000000000000")&&!frame.traceIds.contains(id)&&frame.traceIds.size()<256)frame.traceIds.add(id);}
    private static String remoteText(Task task){String status=task.status().message()==null?"":A2aPartContent.extract(task.status().message().parts());return A2aPartContent.extractTaskResult(task,status,null);}
    private static boolean ended(TaskShelf.State state){return Set.of(TaskShelf.State.COMPLETED,TaskShelf.State.FAILED,TaskShelf.State.ABANDONED).contains(state);}
    private static String code(RuntimeException e){String value=e.getMessage();return value!=null&&value.matches("[A-Z][A-Z0-9_]{1,100}")?value:"BUSINESS_EXECUTION_FAILED";}
    private static IllegalStateException error(String code){return new IllegalStateException(code);}
    @Override public QueryResponse query(ServeRequest request){
        String external=request.getConversationId(),internal;
        if(external==null||external.isBlank()){internal=create().id;external=internal;}
        else if(conversations.containsKey(external))internal=external;
        else{if(external.length()>128)throw error("INVALID_CONVERSATION_ID");internal=externalConversations.computeIfAbsent(external,key->create().id);}
        var replies=Json.object(request.getMetadata().get("runtime.remoteToolResults"));View result;
        if(replies.isEmpty())result=message(internal,request.lastUserQuery());
        else{
            if(replies.size()!=1)throw error("ONE_REPLY_PER_TASK");String token=replies.keySet().iterator().next(),answer=Objects.toString(replies.get(token),"");var existing=view(internal);
            if(existing.switchRequest!=null&&existing.switchRequest.requestId.equals(token)){
                String choice=switch(answer.trim()){case "保留","保留并切换","RETAIN"->"RETAIN";case "暂不切换","STAY"->"STAY";case "放弃并切换","DISCARD"->"DISCARD";default->throw error("EXPLICIT_SWITCH_DECISION_REQUIRED");};
                result=decide(internal,token,choice);
            }else if(existing.stack.resumeCandidate()!=null&&token.equals("resume:"+existing.stack.resumeCandidate())){
                if(!Set.of("继续","续办","确认","resume").contains(answer.trim()))throw error("EXPLICIT_RESUME_DECISION_REQUIRED");result=resume(internal,existing.stack.resumeCandidate());
            }else if(token.equals("clarify:"+internal))result=message(internal,answer);
            else{
                var current=existing.stack.current();if(current==null)throw error("NO_CURRENT_TASK");
                if(token.equals("receipt:"+current.id()))result=receipt(internal,current.id());else result=reply(internal,current.id(),token,answer);
            }
        }
        var output=new LinkedHashMap<String,Object>();output.put("role","assistant");output.put("workbench",result);
        Map<String,Object> interrupt=runtimeInterrupt(result);output.put("content",interrupt.isEmpty()?Json.write(result.stack):interrupt.get("message"));
        if(!interrupt.isEmpty())output.put("_interrupt",interrupt);
        return new QueryResponse(output,external,Map.of("workbenchConversationId",internal));
    }
    private Map<String,Object> runtimeInterrupt(View view){
        String token=null,message=null;
        if(view.switchRequest!=null){token=view.switchRequest.requestId;message="原任务尚未结束。请选择：保留并切换 / 暂不切换 / 放弃并切换。已提交操作不能放弃。";}
        else if(!view.clarification.isBlank()){token="clarify:"+view.conversationId;message=view.clarification;}
        else if(view.stack.resumeCandidate()!=null){token="resume:"+view.stack.resumeCandidate();message="新任务已结束，原任务尚未完成。是否继续续办？";}
        else if(view.stack.current()!=null){
            var current=view.tasks.stream().filter(t->t.id.equals(view.stack.current().id())).findFirst().orElse(null);
            if(current!=null&&current.prompt!=null){token=current.prompt.token;message=current.prompt.message;}
            else if(current!=null&&current.state==TaskShelf.State.WAITING_RECEIPT){token="receipt:"+current.id;message="原操作结果未知，请核对原回执；不能重复提交。";}
        }
        return token==null?Map.of():Map.of("type","__interaction__","toolCallId",token,"toolName","ask_user","message",message,"context",Map.of("conversationId",view.conversationId));
    }
    @Override public void streamQuery(ServeRequest request,QueryStreamObserver observer){
        try{var response=query(request);var result=Json.object(response.getResult());Object interrupt=result.get("_interrupt");observer.onNext(new QueryChunk(interrupt==null?QueryChunk.TYPE_CHUNK:QueryChunk.TYPE_INTERRUPT,interrupt==null?result:interrupt));observer.onComplete(response);}catch(RuntimeException e){observer.onError(e);}
    }
}
