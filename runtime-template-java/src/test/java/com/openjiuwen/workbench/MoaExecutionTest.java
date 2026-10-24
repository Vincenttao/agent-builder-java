package com.openjiuwen.workbench;
import com.openjiuwen.workbench.runtime.MoaExecution;
import com.moaagent.agent.skill.*;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.schema.*;
import com.openjiuwen.core.runner.Runner;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class MoaExecutionTest {
 @TempDir Path root;
 @Test void runtimeBridgePreservesCoreConfirmationPointAndRejectsForeignReply() throws Exception {
  Files.createDirectories(root.resolve("skills/entry"));Files.writeString(root.resolve("skills/entry/SKILL.md"),"---\nname: entry\ndescription: 测试兑换\n---\n先 confirm_action 后 call_mcp，operation=redeem，arguments={}。");Files.writeString(root.resolve("skills/redeem.py"),"# approved asset");
  var count=new AtomicInteger();var writes=new AtomicInteger();
  var model=new Model((messages,request,client,options)->CompletableFuture.completedFuture(AssistantMessage.builder().content("").toolCalls(List.of(ToolCall.builder().id("call-"+count.incrementAndGet()).name(count.get()==1?"confirm_action":"call_mcp").arguments("{\"operation\":\"redeem\",\"arguments\":{}}").build())).build()));
  var schema=Map.<String,Object>of("type","object","properties",Map.of(),"required",List.of(),"additionalProperties",false);
  var operation=new SkillOperation(SkillOperation.Type.SCRIPT,"兑换",null,null,null,null,"redeem.py",schema,schema,Map.of(),true,true,2);
  Runner.start().toCompletableFuture().join();
  try(var execution=new MoaExecution("task-test",root.resolve("agent"),new SkillAssets(root.resolve("skills").toString(),"entry"),Map.of("redeem",operation),model,(s,source,input)->{writes.incrementAndGet();return Map.of("success",true,"data",Map.of(),"model_data",Map.of());},"")){
   var first=execution.invoke("兑换礼品");assertNotNull(first.interrupt());assertTrue(first.interrupt().message().contains("确认"));assertEquals(0,writes.get());
   assertThrows(IllegalStateException.class,()->execution.reply("foreign-id","确认"));assertEquals(0,writes.get());
   var result=execution.reply(first.interrupt().id(),"确认");assertNull(result.interrupt());assertEquals(1,writes.get());
   assertThrows(IllegalStateException.class,()->execution.reply(first.interrupt().id(),"确认"));assertEquals(1,writes.get());
  }finally{Runner.stop().toCompletableFuture().join();}
 }
 @Test void inheritedTraceRemainsTheParentAcrossCoreRunnerThread() throws Exception {
  Files.createDirectories(root.resolve("skills/entry"));Files.writeString(root.resolve("skills/entry/SKILL.md"),"---\nname: entry\ndescription: trace\n---\n执行查询");Files.writeString(root.resolve("skills/read.py"),"# read");
  var schema=Map.<String,Object>of("type","object","properties",Map.of(),"required",List.of(),"additionalProperties",false);
  var operation=new SkillOperation(SkillOperation.Type.SCRIPT,"查询",null,null,null,null,"read.py",schema,schema,Map.of(),false,true,1);
  var model=new Model((messages,a,b,c)->CompletableFuture.completedFuture(AssistantMessage.builder().content("").toolCalls(List.of(ToolCall.builder().id("read-1").name("call_mcp").arguments("{\"operation\":\"read\",\"arguments\":{}}").build())).build()));
  var provider=io.opentelemetry.sdk.trace.SdkTracerProvider.builder().build();var tracer=provider.get("trace-test");var config=com.openjiuwen.extensions.tracerotel.OtelTracerConfig.builder().isRedactionEnabled(true).build();
  com.openjiuwen.core.session.tracer.TracerHandlerRegistry.registerHandler("trace-test",new com.openjiuwen.extensions.tracerotel.OtelAgentHandler(tracer,config));
  Runner.start().toCompletableFuture().join();var parent=tracer.spanBuilder("business.parent").startSpan();
  try(var scope=parent.makeCurrent();var execution=new MoaExecution("trace-task",root.resolve("agent"),new SkillAssets(root.resolve("skills").toString(),"entry"),Map.of("read",operation),model,(session,source,input)->Map.of("success",true,"data",Map.of(),"model_data",Map.of()),"")){
   var turn=execution.invoke("查询");assertEquals(parent.getSpanContext().getTraceId(),turn.traceId());assertEquals(parent.getSpanContext(),io.opentelemetry.api.trace.Span.current().getSpanContext());
  }finally{parent.end();com.openjiuwen.core.session.tracer.TracerHandlerRegistry.unregisterHandler("trace-test");Runner.stop().toCompletableFuture().join();provider.close();}
 }

}
