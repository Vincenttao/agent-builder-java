package com.openjiuwen.workbench;
import com.openjiuwen.workbench.runtime.*;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.schema.AssistantMessage;
import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
class LlmRouterTest {
 BusinessAssets assets(){return new BusinessAssets(Path.of("../examples/idou"));}
 Model model(String json){return new Model((messages,a,b,c)->CompletableFuture.completedFuture(AssistantMessage.builder().content(json).build()));}
 @Test void routerUsesSavedScopeInstructionsAndSkillToChooseMountedTarget(){
  var prompt=new AtomicReference<String>();
  var router=new LlmRouter(assets(),new Model((messages,a,b,c)->{prompt.set(messages.toString());return CompletableFuture.completedFuture(AssistantMessage.builder().content("{\"action\":\"SKILL\",\"target\":\"benefits\",\"reason\":\"福利余额\",\"question\":\"\"}").build());}));
  var choice=router.decide("查询余额",null,null,null);assertEquals(LlmRouter.Action.SKILL,choice.action());assertEquals("benefits",choice.target());
  assertTrue(prompt.get().contains("员工i豆余额"));assertTrue(prompt.get().contains("调用 finish"));
 }
 @Test void unmountedTargetAndContinuationWithoutTaskAreRejected(){
  for(String answer:new String[]{"{\"action\":\"SKILL\",\"target\":\"shell\",\"reason\":\"x\",\"question\":\"\"}","{\"action\":\"CONTINUE\",\"target\":\"task-A\",\"reason\":\"x\",\"question\":\"\"}"}){
   var router=new LlmRouter(assets(),model(answer));assertThrows(IllegalStateException.class,()->router.decide("执行",null,null,null));
  }
 }
 @Test void explicitTaskContinuationKeepsOriginalTaskAndAmbiguityDoesNotSelectFallback(){
  var router=new LlmRouter(assets(),model("{\"action\":\"CONTINUE\",\"target\":\"task-A\",\"reason\":\"确认原任务\",\"question\":\"\"}"));
  assertEquals("task-A",router.decide("确认","task-A","benefits","确认兑换？").target());
  var clarify=new LlmRouter(assets(),model("{\"action\":\"CLARIFY\",\"target\":\"\",\"reason\":\"未匹配\",\"question\":\"请说明需要哪项服务？\"}"));assertEquals(LlmRouter.Action.CLARIFY,clarify.decide("帮我办一下",null,null,null).action());
 }
 @Test void invalidHandoffAndDefinitionConflictCannotDispatch(){
  var router=new LlmRouter(assets(),model("{\"action\":\"HANDOFF\",\"target\":\"procurement\",\"reason\":\"out\",\"question\":\"\"}"));assertThrows(IllegalStateException.class,()->router.decide("其他业务",null,null,null));
  var conflict=new LlmRouter(assets(),model("{\"action\":\"CONFLICT\",\"target\":\"\",\"reason\":\"范围与指令矛盾，需要Coding助手修订\",\"question\":\"\"}"));assertEquals(LlmRouter.Action.CONFLICT,conflict.decide("执行",null,null,null).action());
 }
}
