package com.openjiuwen.workbench;

import com.openjiuwen.workbench.runtime.*;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.schema.*;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;

class BusinessHostTest {
 @TempDir Path root;
 HttpServer server;BusinessHost host;Model routeModel,skillModel;AtomicInteger remote=new AtomicInteger(),third=new AtomicInteger(),writes=new AtomicInteger(),reads=new AtomicInteger(),modelCalls=new AtomicInteger();
 AtomicInteger available=new AtomicInteger(1280);
 AtomicBoolean failB=new AtomicBoolean(),delayWrite=new AtomicBoolean();String orderKey;
 @BeforeEach void setup() throws Exception {
  server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.setExecutor(Executors.newCachedThreadPool(r->{var t=new Thread(r);t.setDaemon(true);return t;}));
  server.createContext("/",exchange->{try{
   String path=exchange.getRequestURI().getPath();Object response;
   if(path.endsWith("/balance")){reads.incrementAndGet();response=Map.of("employee",Map.of("wallet",Map.of("availablePoints",available.get())));}
   else if(path.equals("/api/gifts")){reads.incrementAndGet();response=Map.of("gifts",List.of(Map.of("id","coffee","name","咖啡券","points",100)));}
   else if(path.equals("/api/redemptions")){var input=Json.object(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));orderKey=input.get("idempotencyKey").toString();writes.incrementAndGet();response=Map.of("order",Map.of("id","order-1","status","completed"));if(delayWrite.get())Thread.sleep(1500);}
   else if(path.startsWith("/api/redemptions/by-key/")){reads.incrementAndGet();assertEquals(orderKey,path.substring(path.lastIndexOf('/')+1));response=Map.of("order",Map.of("id","order-1","status","completed"));}
   else {
    if(path.endsWith("fallback"))third.incrementAndGet();else remote.incrementAndGet();var rpc=Json.object(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));var message=Json.object(Json.object(rpc.get("params")).get("message"));String state=(message.get("taskId")==null||message.get("taskId").toString().isBlank())?"TASK_STATE_INPUT_REQUIRED":failB.get()?"TASK_STATE_FAILED":"TASK_STATE_COMPLETED";
    response=Map.of("jsonrpc","2.0","id",rpc.get("id"),"result",Map.of("task",Map.of("id","remote-B","contextId",message.get("contextId"),"status",Map.of("state",state,"timestamp","2026-10-25T00:00:00Z","message",Map.of("role","ROLE_AGENT","messageId","answer","parts",List.of(Map.of("text",state.endsWith("REQUIRED")?"请确认采购":"采购处理结束")))))));
   }
   byte[] body=Json.write(response).getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);
  }catch(Exception ignored){}finally{exchange.close();}});server.start();
  Path source=Path.of("../examples/idou"),assets=root.resolve("assets");try(var files=Files.walk(source)){for(Path from:files.toList()){Path to=assets.resolve(source.relativize(from));if(Files.isDirectory(from))Files.createDirectories(to);else Files.copy(from,to);}}
  String base="http://127.0.0.1:"+server.getAddress().getPort();var definition=Json.object(Files.readString(assets.resolve("application.json")));definition.put("connections",Map.of("idou",base,"procurement",base+"/a2a/procurement","fallback",base+"/a2a/fallback"));Files.writeString(assets.resolve("application.json"),Json.write(definition));
  routeModel=new Model((messages,a,b,c)->{String query=messages.get(messages.size()-1).getContent().toString();String action=query.contains("冲突")?"CONFLICT":query.contains("采购")?"DELEGATE":query.contains("范围外")?"HANDOFF":"SKILL";String target=action.equals("CONFLICT")?"":action.equals("DELEGATE")?"procurement":action.equals("HANDOFF")?"fallback":"benefits";return CompletableFuture.completedFuture(AssistantMessage.builder().content(Json.write(Map.of("action",action,"target",target,"reason","固定测试路由","question",""))).build());});
  skillModel=new Model((messages,a,b,c)->{int n=modelCalls.incrementAndGet();return CompletableFuture.completedFuture(AssistantMessage.builder().content("").toolCalls(List.of(ToolCall.builder().id("skill-call-"+n).name(n%2==1?"confirm_action":"call_mcp").arguments("{\"operation\":\"redeem\",\"arguments\":{\"giftId\":\"coffee\",\"quantity\":1}}").build())).build());});
  host=new BusinessHost(new BusinessAssets(assets),routeModel,skillModel,root.resolve("state"));host.start();
 }
 @AfterEach void close(){if(host!=null)host.stop();if(server!=null)server.stop(0);}
 BusinessHost.TaskView current(BusinessHost.View view){return view.tasks().stream().filter(t->t.id().equals(view.stack().current().id())).findFirst().orElseThrow();}
 BusinessHost.View startA(){return host.message(null,"兑换1张咖啡券");}
 BusinessHost.View switchB(BusinessHost.View a){var question=host.message(a.conversationId(),"申请采购");assertEquals(0,remote.get());return host.decide(a.conversationId(),question.switchRequest().requestId(),"RETAIN");}
 @Test void realMoaAtoSdkBtoARequiresNewConfirmationAndBlocksC(){
  var a=startA();String aid=current(a).id(),old=current(a).prompt().token();assertEquals(0,writes.get());
  var b=switchB(a);String bid=current(b).id();assertEquals(1,remote.get());assertEquals(aid,b.stack().retained().id());assertNotNull(current(b).prompt(),Json.write(b));
  assertThrows(IllegalStateException.class,()->host.message(a.conversationId(),"明确范围外问题"));assertEquals(0,third.get());assertEquals(bid,host.view(a.conversationId()).stack().current().id());
  var doneB=host.reply(a.conversationId(),bid,current(b).prompt().token(),"确认");assertEquals(aid,doneB.stack().resumeCandidate());
  var resumed=host.resume(a.conversationId(),aid);var restored=current(resumed);assertEquals(aid,restored.id());assertNotEquals(old,restored.prompt().token());assertEquals(2,reads.get());assertEquals(0,writes.get());
  assertThrows(IllegalStateException.class,()->host.reply(a.conversationId(),aid,old,"确认"));assertEquals(0,writes.get());
  var done=host.reply(a.conversationId(),aid,restored.prompt().token(),"确认");assertEquals(TaskShelf.State.COMPLETED,done.stack().current().state());assertEquals(1,writes.get());assertEquals(2,done.tasks().size());assertEquals(2,modelCalls.get());
  assertTrue(done.events().stream().anyMatch(e->e.get("type").equals("write_authorized")&&Json.object(e.get("data")).get("arguments") instanceof Map));
  long events=done.events().size();for(int n=0;n<5;n++)assertEquals(events,host.view(a.conversationId()).events().size());assertEquals(1,writes.get());assertEquals(2,remote.get());
 }
 @Test void bFailureDoesNotLoseAAndStayingHasNoRemoteCall(){
  var a=startA();var question=host.message(a.conversationId(),"申请采购");var stay=host.decide(a.conversationId(),question.switchRequest().requestId(),"STAY");assertEquals(current(a).id(),current(stay).id());assertEquals(0,remote.get());
  var b=switchB(a);failB.set(true);var failed=host.reply(a.conversationId(),current(b).id(),current(b).prompt().token(),"确认");assertEquals(TaskShelf.State.FAILED,failed.stack().current().state());assertEquals(current(a).id(),failed.stack().resumeCandidate());
  assertNotNull(current(host.resume(a.conversationId(),current(a).id())).prompt());assertEquals(0,writes.get());
 }
 @Test void unknownWriteKeepsLayerAndLateReceiptUpdatesAWithoutStealingB(){
  delayWrite.set(true);var a=startA();String aid=current(a).id();var unknown=host.reply(a.conversationId(),aid,current(a).prompt().token(),"确认");assertEquals(TaskShelf.State.WAITING_RECEIPT,unknown.stack().current().state());assertEquals(1,writes.get());
  var b=switchB(a);String bid=current(b).id();assertThrows(IllegalStateException.class,()->host.message(a.conversationId(),"明确范围外问题"));assertEquals(0,third.get());
  var receipt=host.receipt(a.conversationId(),aid);assertEquals(bid,receipt.stack().current().id());assertNull(receipt.stack().retained());assertEquals(1,writes.get());
  var finished=host.reply(a.conversationId(),bid,current(b).prompt().token(),"确认");assertNull(finished.stack().resumeCandidate());assertThrows(IllegalStateException.class,()->host.resume(a.conversationId(),aid));assertEquals(1,writes.get());
 }
 @Test void failedResumeReviewKeepsAWithoutAWriteAndCanBeRetried(){
  var a=startA();String aid=current(a).id();var b=switchB(a);host.reply(a.conversationId(),current(b).id(),current(b).prompt().token(),"确认");
  available.set(50);var blocked=host.resume(a.conversationId(),aid);assertEquals(TaskShelf.State.NEEDS_REVIEW,blocked.stack().current().state());assertNull(current(blocked).prompt());assertEquals(0,writes.get());
  assertThrows(IllegalStateException.class,()->host.reply(a.conversationId(),aid,current(a).prompt().token(),"确认"));
  available.set(1280);var reviewed=host.resume(a.conversationId(),aid);assertNotNull(current(reviewed).prompt());assertEquals(0,writes.get());
 }

 void setPolicy(String field,String value) throws Exception {
  host.stop();Path assets=root.resolve("assets");var spec=Json.object(Files.readString(assets.resolve("application.json")));var policy=Json.object(spec.get("handoff"));policy.put(field,value);spec.put("handoff",policy);Files.writeString(assets.resolve("application.json"),Json.write(spec));
  host=new BusinessHost(new BusinessAssets(assets),routeModel,skillModel,root.resolve("state"));host.start();
 }
 @Test void automaticResumeStillRechecksFactsAndNeedsFreshConfirmation() throws Exception {
  setPolicy("resume","auto");var a=startA();var b=switchB(a);var result=host.reply(a.conversationId(),current(b).id(),current(b).prompt().token(),"确认");
  assertEquals(current(a).id(),current(result).id());assertNotNull(current(result).prompt());assertNotEquals(current(a).prompt().token(),current(result).prompt().token());assertEquals(2,reads.get());assertEquals(0,writes.get());
 }
 @Test void discardUnsubmittedAEndsItAndNeverOffersToResumeIt(){
  var a=startA();var question=host.message(a.conversationId(),"申请采购");var b=host.decide(a.conversationId(),question.switchRequest().requestId(),"DISCARD");assertEquals(TaskShelf.State.ABANDONED,b.stack().tasks().get(0).state());
  assertThrows(IllegalStateException.class,()->host.reply(a.conversationId(),current(a).id(),current(a).prompt().token(),"确认"));
  var result=host.reply(a.conversationId(),current(b).id(),current(b).prompt().token(),"确认");assertNull(result.stack().resumeCandidate());assertEquals(0,writes.get());
 }
 @Test void knownDefinitionConflictBlocksPendingAndNewConversationDispatch(){
  var a=startA();var blocked=host.message(a.conversationId(),"检测定义冲突");assertTrue(blocked.conflict());
  assertThrows(IllegalStateException.class,()->host.reply(a.conversationId(),current(a).id(),current(a).prompt().token(),"确认"));
  assertThrows(IllegalStateException.class,()->host.message(null,"兑换礼品"));assertEquals(0,writes.get());assertEquals(0,remote.get());
 }

 @Test void runtimeSpiKeepsExternalConversationAndReportsInputRequiredUntilConfirmation(){
  var request=new com.openjiuwen.service.spec.dto.ServeRequest();request.setConversationId("external-conversation");request.setMessages(List.of(Map.of("role","user","content","兑换1张咖啡券")));
  var first=host.query(request);assertEquals("external-conversation",first.getConversationId());var output=Json.object(first.getResult());var interrupt=Json.object(output.get("_interrupt"));assertFalse(interrupt.isEmpty());assertEquals(0,writes.get());
  request.setMessages(List.of());request.setMetadata(Map.of("runtime.remoteToolResults",Map.of(interrupt.get("toolCallId").toString(),"确认")));
  var result=host.query(request);assertFalse(Json.object(result.getResult()).containsKey("_interrupt"));assertEquals(1,writes.get());
 }

}
