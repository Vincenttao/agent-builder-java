package com.openjiuwen.workbench;
import com.openjiuwen.workbench.runtime.*;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.schema.*;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import java.nio.file.*;import java.net.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
import static org.junit.jupiter.api.Assertions.*;
class WealthHostTest {
 @org.junit.jupiter.api.io.TempDir Path root;BusinessHost host;HttpServer server;AtomicInteger balance=new AtomicInteger(100000),transfers=new AtomicInteger(),purchases=new AtomicInteger(),steps=new AtomicInteger();boolean rejectPurchase,skipTransferConfirmation;
 @BeforeEach void setup() throws Exception {
  server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.setExecutor(Executors.newCachedThreadPool(r->{var t=new Thread(r);t.setDaemon(true);return t;}));
  server.createContext("/api/wealth/",exchange->{try{var path=exchange.getRequestURI().getPath();Map<String,Object> response;
   if(path.endsWith("/plan"))response=Map.of("mock",true,"productId","demo-wealth-a","productName","演示理财A","amountFen",300000,"availableFen",balance.get(),"fundingFen",500000,"shortfallFen",Math.max(0,300000-balance.get()),"canPurchase",balance.get()>=300000,"summary",balance.get()<300000?"余额1000元不足，需转入2000元":"余额充足");
   else{var body=Json.object(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));if(path.endsWith("transfers")){transfers.incrementAndGet();balance.addAndGet(200000);}else{purchases.incrementAndGet();balance.addAndGet(-300000);}response=Map.of("orderId",path.endsWith("transfers")?"transfer-test":"purchase-test","idempotencyKey",body.get("idempotencyKey"));}
   var bytes=Json.write(response).getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);
  }catch(Exception ignored){}finally{exchange.close();}});server.start();
  Path source=Path.of("../examples/commerce-wealth"),assets=root.resolve("assets");try(var paths=Files.walk(source)){for(var from:paths.toList()){var to=assets.resolve(source.relativize(from));if(Files.isDirectory(from))Files.createDirectories(to);else Files.copy(from,to);}}
  var definition=Json.object(Files.readString(assets.resolve("application.json")));definition.put("connections",Map.of("idou","http://127.0.0.1:"+server.getAddress().getPort(),"wealth","http://127.0.0.1:"+server.getAddress().getPort()));Files.writeString(assets.resolve("application.json"),Json.write(definition));
  var route=new Model((m,a,b,c)->CompletableFuture.completedFuture(AssistantMessage.builder().content("{\"action\":\"SKILL\",\"target\":\"wealth\",\"reason\":\"确定性理财归属测试\",\"question\":\"\"}").build()));
  var model=new Model((m,a,b,c)->{int n=steps.incrementAndGet();if(n==6&&rejectPurchase||n>=3&&skipTransferConfirmation)return CompletableFuture.completedFuture(AssistantMessage.builder().content("本次操作结束，已发生的转账不撤销。").build());String operation=n==1||n==4?"wealth_plan":n==2||n==3?"transfer":"purchase";String tool=n==2&&!skipTransferConfirmation||n==5?"confirm_action":"call_mcp";String args=operation.equals("transfer")?"{\"productId\":\"demo-wealth-a\",\"amountFen\":200000,\"purchaseAmountFen\":300000}":"{\"productId\":\"demo-wealth-a\",\"amountFen\":300000}";return CompletableFuture.completedFuture(AssistantMessage.builder().content("").toolCalls(List.of(ToolCall.builder().id("wealth-call-"+n).name(tool).arguments("{\"operation\":\""+operation+"\",\"arguments\":"+args+"}").build())).build());});
  host=new BusinessHost(new BusinessAssets(assets),route,model,root.resolve("state"));host.start();
 }
 @AfterEach void close(){if(host!=null)host.stop();if(server!=null)server.stop(0);}
 BusinessHost.TaskView current(BusinessHost.View v){return v.tasks().stream().filter(t->t.id().equals(v.stack().current().id())).findFirst().orElseThrow();}
 BusinessHost.View start(){return host.message(null,"购买演示理财A3000元，余额不足时先询问转账");}
 BusinessHost.View reply(BusinessHost.View v,String text){var t=current(v);return host.reply(v.conversationId(),t.id(),t.prompt().token(),text);}
 @Test void transferDoesNotPurchaseAndSecondConfirmationIsRequired(){var first=start();assertEquals(TaskShelf.State.WAITING_INPUT,first.stack().current().state());assertTrue(current(first).prompt().message().contains("资金不足"));assertEquals(0,transfers.get());var second=reply(first,"确认");assertEquals(1,transfers.get());assertEquals(0,purchases.get());assertEquals(TaskShelf.State.WAITING_INPUT,second.stack().current().state());assertNotEquals(current(first).prompt().token(),current(second).prompt().token());var done=reply(second,"确认");assertEquals(TaskShelf.State.COMPLETED,done.stack().current().state());assertEquals(1,purchases.get());assertEquals(0,balance.get());assertThrows(IllegalStateException.class,()->reply(second,"确认"));assertEquals(1,purchases.get());}
 @Test void rejectingPurchaseKeepsSuccessfulTransferVisible(){rejectPurchase=true;var second=reply(start(),"确认");var done=reply(second,"拒绝");assertEquals(TaskShelf.State.COMPLETED,done.stack().current().state());assertEquals(1,transfers.get());assertEquals(0,purchases.get());assertEquals(300000,balance.get());assertEquals("rejected",current(done).output().get("userDecision"));assertTrue(Json.write(current(done).output().get("completedWrites")).contains("transfer"));}
 @Test void modelCannotSkipTransferConfirmation(){skipTransferConfirmation=true;var done=start();assertEquals(TaskShelf.State.FAILED,done.stack().current().state());assertEquals(0,transfers.get());assertEquals(0,purchases.get());}
 @Test void disablingMoneyConfirmationInAssetsIsRejected()throws Exception{var path=root.resolve("assets/adapters/operations.json");var catalog=Json.object(Files.readString(path));var transfer=Json.object(catalog.get("transfer"));transfer.put("confirmationRequired",false);catalog.put("transfer",transfer);Files.writeString(path,Json.write(catalog));assertThrows(IllegalArgumentException.class,()->new BusinessAssets(root.resolve("assets")));}
}
