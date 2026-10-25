package com.openjiuwen.workbench;
import com.openjiuwen.workbench.runtime.*;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.schema.AssistantMessage;
import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import static org.junit.jupiter.api.Assertions.*;
class RoutingContextContractTest {
 @Test void routingProjectionKeepsScopeArraysAndOriginalWaitingPoint(){
  var assets=new BusinessAssets(Path.of("../examples/idou"));
  var router=new LlmRouter(assets,new Model((messages,a,b,c)->{
   String prompt=messages.get(0).getContent().toString();int at=prompt.indexOf("{\"definition\"");assertTrue(at>=0);var context=Json.object(prompt.substring(at));var expected=Json.object(assets.definition().get("scope"));var saved=Json.object(Json.object(context.get("definition")).get("scope"));
   for(String name:java.util.List.of("own","delegated","outside"))assertEquals(expected.get(name),saved.get(name));
   if(context.containsKey("routingContext")){var projection=Json.object(context.get("routingContext"));assertEquals(expected.get("own"),projection.get("ownScope"));assertEquals(expected.get("delegated"),projection.get("delegatedScope"));assertEquals(expected.get("outside"),projection.get("outsideScope"));}
   assertEquals("task-A",context.get("currentTask"));assertEquals("benefits",context.get("currentTarget"));assertEquals("确认兑换？",context.get("currentQuestion"));
   return CompletableFuture.completedFuture(AssistantMessage.builder().content("{\"action\":\"DELEGATE\",\"target\":\"procurement\",\"reason\":\"明确的新采购需求，原任务处置交宿主\",\"question\":\"\"}").build());
  }));assertEquals(LlmRouter.Action.DELEGATE,router.decide("申请采购设备","task-A","benefits","确认兑换？").action());
 }
}
