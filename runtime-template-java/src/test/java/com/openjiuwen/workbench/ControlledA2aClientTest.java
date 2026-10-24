package com.openjiuwen.workbench;
import com.openjiuwen.workbench.runtime.ControlledA2aClient;
import com.moaagent.agent.support.Json;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.util.*;
import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
class ControlledA2aClientTest {
 @Test void sdkUsesVersionOneAndKeepsOriginalTaskAndContext() throws Exception {
  var count=new AtomicInteger();var captured=new ArrayList<Map<String,Object>>();
  var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/a2a",exchange->{var rpc=Json.object(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));captured.add(rpc);boolean first=count.incrementAndGet()==1;
   var message=Json.object(Json.object(rpc.get("params")).get("message"));var task=Map.of("id","remote-task","contextId",message.get("contextId"),"status",Map.of("state",first?"TASK_STATE_INPUT_REQUIRED":"TASK_STATE_COMPLETED","timestamp","2026-10-25T00:00:00Z","message",Map.of("role","ROLE_AGENT","messageId","reply","parts",List.of(Map.of("text",first?"请确认":"已完成")))),"artifacts",List.of());
   byte[] body=Json.write(Map.of("jsonrpc","2.0","id",rpc.get("id"),"result",Map.of("task",task))).getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();});server.start();
  try(var client=new ControlledA2aClient(Map.of("procurement","http://127.0.0.1:"+server.getAddress().getPort()+"/a2a"))){
   var first=client.send("procurement","context-A",null,"申请采购");assertTrue(first.status().state().isInterrupted());
   var second=client.send("procurement","context-A",first.id(),"确认");assertTrue(second.status().state().isFinal());assertEquals(first.id(),second.id());
   assertEquals(2,count.get());assertEquals("SendMessage",captured.get(0).get("method"));
   var message=Json.object(Json.object(captured.get(1).get("params")).get("message"));assertEquals("remote-task",message.get("taskId"));assertEquals("context-A",message.get("contextId"));
   assertThrows(IllegalArgumentException.class,()->client.send("unknown","context-A",null,"执行"));assertEquals(2,count.get());
  }finally{server.stop(0);}
 }
 @Test void mismatchedRemoteContextIsRejectedWithoutRetry() throws Exception {
  var calls=new AtomicInteger();var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/a2a",exchange->{calls.incrementAndGet();var rpc=Json.object(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));byte[] body=Json.write(Map.of("jsonrpc","2.0","id",rpc.get("id"),"result",Map.of("task",Map.of("id","foreign-task","contextId","foreign-context","status",Map.of("state","TASK_STATE_INPUT_REQUIRED","timestamp","2026-10-25T00:00:00Z"))))).getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();});server.start();
  try(var client=new ControlledA2aClient(Map.of("target","http://127.0.0.1:"+server.getAddress().getPort()+"/a2a"))){assertThrows(IllegalStateException.class,()->client.send("target","expected-context",null,"处理"));assertEquals(1,calls.get());}finally{server.stop(0);}
 }
}
