package com.openjiuwen.workbench.deep;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
/** Workbench adapter for one goal per conversation. No MOA router or A/B task stack. */
public final class DeepHost implements AutoCloseable {
 public interface Executor extends AutoCloseable {Map<String,Object> invoke(String query);void close();}
 public interface Factory {Executor create(String id,ArtifactTools tools);}
 private final Path root;private final Factory factory;private final Map<String,Conversation> conversations=new LinkedHashMap<>();
 private static final class Conversation {String id;Executor executor;ArtifactTools tools;volatile boolean busy;int turns;List<Map<String,Object>> artifacts=List.of();List<Map<String,Object>> tasks=new ArrayList<>(),events=new ArrayList<>();}
 public DeepHost(Path root,Factory factory){this.root=root;this.factory=factory;}
 public synchronized Map<String,Object> reserve(){if(conversations.size()>=20)throw new IllegalStateException("CONVERSATION_LIMIT");var c=new Conversation();c.id=UUID.randomUUID().toString();c.tools=new ArtifactTools(root.resolve(c.id),e->event(c,e));conversations.put(c.id,c);return snapshot(c);}
 private synchronized Conversation get(String id){var c=conversations.get(id);if(c==null)throw new IllegalArgumentException("CONVERSATION_NOT_FOUND");return c;}
 private synchronized void event(Conversation c,Map<String,Object> data){if(c.events.size()>=256)return;var e=new LinkedHashMap<String,Object>();e.put("sequence",c.events.size()+1);e.put("time",Instant.now().toString());e.put("type",data.get("type"));e.put("data",data);c.events.add(e);}
 public Map<String,Object> message(String id,String query){var c=get(id);synchronized(this){if(c.busy)throw new IllegalStateException("RUN_BUSY");if(query==null||query.isBlank()||query.length()>12000)throw new IllegalArgumentException("INVALID_QUERY");if(c.turns++>=20)throw new IllegalStateException("TURN_LIMIT");c.busy=true;}
  try{if(c.executor==null)c.executor=factory.create(c.id,c.tools);c.tools.beginTurn();event(c,Map.of("type","goal_started"));var result=c.executor.invoke(query);boolean ready=containsPromise(result)&&c.tools.verified()&&c.tools.artifacts().stream().anyMatch(a->!String.valueOf(a.get("content")).isBlank());var task=new LinkedHashMap<String,Object>();task.put("id",UUID.randomUUID().toString());task.put("kind","deepagent");task.put("target","DeepAgent 独立业务目标");task.put("query",query);task.put("state",ready?"COMPLETED":"FAILED");task.put("output",result);if(!ready)task.put("error","ARTIFACT_NOT_VERIFIED");var artifacts=c.tools.artifacts();synchronized(this){c.tasks.add(task);c.artifacts=artifacts;}event(c,Map.of("type",ready?"artifact_verified":"artifact_unverified"));
  }catch(RuntimeException e){event(c,Map.of("type","goal_failed","reason","DEEP_EXECUTION_FAILED"));throw new IllegalStateException("DEEP_EXECUTION_FAILED");}finally{c.busy=false;}
  return view(id);
 }
 private static boolean containsPromise(Object value){if(value instanceof Map<?,?> m)return m.entrySet().stream().anyMatch(e->e.getKey().equals("content")&&String.valueOf(e.getValue()).contains("ARTIFACTS_READY")||containsPromise(e.getValue()));if(value instanceof List<?> l)return l.stream().anyMatch(DeepHost::containsPromise);return false;}
 public synchronized Map<String,Object> view(String id){return snapshot(get(id));}
 private Map<String,Object> snapshot(Conversation c){return Map.of("conversationId",c.id,"mode","deepagent","busy",c.busy,"stack",Map.of(),"tasks",List.copyOf(c.tasks),"events",List.copyOf(c.events),"artifacts",c.artifacts,"live",true);}
 public synchronized void close(){for(var c:conversations.values())if(c.executor!=null)c.executor.close();}
}
