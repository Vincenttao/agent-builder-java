package com.openjiuwen.workbench.runtime;

import com.openjiuwen.core.session.AgentSession;
import java.time.Instant;
import java.util.*;

/** Same-process two-task business state. Core invocation remains in the host, outside these transitions. */
public final class TaskShelf {
    public enum Policy {ASK,RETAIN,DISCARD}
    public enum Decision {STAY,RETAIN,DISCARD}
    public enum State {ACTIVE,WAITING_INPUT,WAITING_RECEIPT,NEEDS_REVIEW,COMPLETED,FAILED,ABANDONED}
    public record View(String id,String target,State state,String submittedCall){}
    public record Event(long sequence,String time,String type,String taskId,Map<String,String> details){}
    public record Snapshot(View current,View retained,String resumeCandidate,List<View> tasks){}
    private static final class Task {
        final String id=UUID.randomUUID().toString();final String target;
        final AgentSession session=new AgentSession(id,new LinkedHashMap<>(),null);
        State state=State.ACTIVE;String inputToken;String submittedCall;final Set<String> issuedTokens=new HashSet<>();
        Task(String target){this.target=target;}
        View view(){return new View(id,target,state,submittedCall);}
        boolean ended(){return state==State.COMPLETED||state==State.FAILED||state==State.ABANDONED;}
    }
    private record Switch(String id,String sourceId,String target){}
    private final Set<String> targets;
    private final Map<String,Task> tasks=new LinkedHashMap<>();
    private final Deque<Event> events=new ArrayDeque<>();
    private Task current,retained;private Switch pending;private long sequence;

    public TaskShelf(Set<String> targets){this.targets=Set.copyOf(targets);}
    public synchronized String start(String target){
        validateTarget(target);
        if(current!=null&&!current.ended()||retained!=null)throw error("TASK_ALREADY_ACTIVE");
        current=create(target);event("task_started",current,Map.of("target",target));return current.id;
    }
    public synchronized String requestSwitch(String target,Policy policy){
        validateTarget(target);Objects.requireNonNull(policy);requireCurrent();
        if(pending!=null)throw error("SWITCH_DECISION_PENDING");
        if(current.ended())throw error("RESUME_OR_START_REQUIRED");
        if(target.equals(current.target)||retained!=null&&target.equals(retained.target))throw error("HANDOFF_CYCLE_BLOCKED");
        if(retained!=null&&policy!=Policy.DISCARD)throw error("TASK_DEPTH_LIMIT");
        if(policy==Policy.DISCARD&&current.submittedCall!=null)throw error("SUBMITTED_OPERATION_CANNOT_BE_DISCARDED");
        if(tasks.size()>=128)throw error("TASK_RETENTION_LIMIT");
        if(policy==Policy.ASK){pending=new Switch(UUID.randomUUID().toString(),current.id,target);event("switch_decision_required",current,Map.of("requestId",pending.id,"target",target));return pending.id;}
        switchNow(target,policy);return current.id;
    }
    public synchronized void decide(String request,Decision decision){
        Objects.requireNonNull(decision);
        if(pending==null||!pending.id.equals(request)||!pending.sourceId.equals(current.id))throw error("STALE_SWITCH_DECISION");
        var chosen=pending;
        if(decision==Decision.STAY){pending=null;event("switch_declined",current,Map.of("target",chosen.target));return;}
        if(current.ended()){pending=null;throw error("STALE_SWITCH_DECISION");}
        if(decision==Decision.DISCARD&&current.submittedCall!=null)throw error("SUBMITTED_OPERATION_CANNOT_BE_DISCARDED");
        pending=null;switchNow(chosen.target,decision==Decision.DISCARD?Policy.DISCARD:Policy.RETAIN);
    }
    private void switchNow(String target,Policy policy){
        Task previous=current;previous.inputToken=null;
        if(policy==Policy.DISCARD){previous.state=State.ABANDONED;event("task_abandoned",previous,Map.of());}
        else {retained=previous;event("task_retained",previous,Map.of("state",previous.state.name()));}
        // Persist the original disposition before the host is allowed to call the new target.
        current=create(target);event("handoff_started",current,Map.of("fromTask",previous.id,"target",target));
    }
    public synchronized void waitForInput(String id,String token){
        Task task=active(id);if(task.submittedCall!=null||task.state==State.NEEDS_REVIEW)throw error("INPUT_NOT_ALLOWED");
        if(token==null||token.isBlank())throw new IllegalArgumentException("Missing input token");
        if(!task.issuedTokens.add(token))throw error("STALE_TASK_INPUT");
        task.state=State.WAITING_INPUT;task.inputToken=token;event("input_required",task,Map.of("token",token));
    }
    public synchronized void checkInput(String id,String token){
        Task task=active(id);
        if(task.state!=State.WAITING_INPUT||task.inputToken==null||!task.inputToken.equals(token))throw error("STALE_TASK_INPUT");
    }
    public synchronized void inputAccepted(String id,String token){checkInput(id,token);current.inputToken=null;current.state=State.ACTIVE;event("input_accepted",current,Map.of());}
    public synchronized void submitted(String id,String call){
        Task task=active(id);
        if(task.submittedCall!=null||task.state!=State.ACTIVE)throw error("WRITE_SUBMISSION_NOT_ALLOWED");
        if(call==null||call.isBlank())throw new IllegalArgumentException("Missing operation identifier");
        task.submittedCall=call;task.inputToken=null;task.state=State.WAITING_RECEIPT;event("operation_submitted",task,Map.of("callId",call));
    }
    public synchronized void receipt(String id,String call,boolean success){
        Task task=task(id);
        if(task.submittedCall==null||!task.submittedCall.equals(call))throw error("RECEIPT_CORRELATION_MISMATCH");
        State result=success?State.COMPLETED:State.FAILED;
        if(task.ended()){if(task.state!=result)throw error("CONFLICTING_RECEIPT");return;}
        task.state=result;task.inputToken=null;event("operation_receipt",task,Map.of("callId",call,"state",result.name()));
        if(task==retained)retained=null;
    }
    public synchronized void finish(String id,boolean success){
        Task task=task(id);if(task.ended())throw error("TASK_ALREADY_ENDED");
        if(task.submittedCall!=null)throw error("RECEIPT_REQUIRED");
        task.state=success?State.COMPLETED:State.FAILED;task.inputToken=null;event("task_finished",task,Map.of("state",task.state.name()));
        if(task==retained)retained=null;
    }
    public synchronized void resume(String id){
        if(current==null||!current.ended()||retained==null||!retained.id.equals(id)||retained.ended())throw error("TASK_NOT_RESUMABLE");
        current=retained;retained=null;pending=null;current.inputToken=null;
        current.state=current.submittedCall!=null?State.WAITING_RECEIPT:State.NEEDS_REVIEW;
        event("task_resumed",current,Map.of("state",current.state.name()));
    }
    public synchronized void requireReview(String id){
        Task task=active(id);if(task.submittedCall!=null)throw error("RECEIPT_REQUIRED");task.inputToken=null;task.state=State.NEEDS_REVIEW;event("review_required",task,Map.of());
    }
    public synchronized void review(String id,boolean passed){
        Task task=active(id);if(task.state!=State.NEEDS_REVIEW)throw error("REVIEW_NOT_REQUIRED");
        event("resume_review",task,Map.of("passed",Boolean.toString(passed)));if(passed)task.state=State.ACTIVE;
    }
    public synchronized Snapshot snapshot(){
        String candidate=current!=null&&current.ended()&&retained!=null&&!retained.ended()?retained.id:null;
        return new Snapshot(current==null?null:current.view(),retained==null?null:retained.view(),candidate,tasks.values().stream().map(Task::view).toList());
    }
    public synchronized List<Event> events(){return List.copyOf(events);}
    /** Core session is internal execution state, never included in the public snapshot. */
    public synchronized AgentSession session(String id){return task(id).session;}
    private Task create(String target){if(tasks.size()>=128)throw error("TASK_RETENTION_LIMIT");var task=new Task(target);tasks.put(task.id,task);return task;}
    private Task task(String id){var task=tasks.get(id);if(task==null)throw error("TASK_NOT_FOUND");return task;}
    private Task active(String id){Task task=task(id);if(task!=current||task.ended())throw error("TASK_NOT_CURRENT");return task;}
    private void requireCurrent(){if(current==null)throw error("NO_CURRENT_TASK");}
    private void validateTarget(String target){if(!targets.contains(target))throw new IllegalArgumentException("UNMOUNTED_TARGET");}
    private void event(String type,Task task,Map<String,String> details){events.addLast(new Event(++sequence,Instant.now().toString(),type,task.id,Map.copyOf(details)));if(events.size()>4096)events.removeFirst();}
    private static IllegalStateException error(String code){return new IllegalStateException(code);}
}
