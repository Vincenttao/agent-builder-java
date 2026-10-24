package com.openjiuwen.workbench;
import com.openjiuwen.workbench.runtime.BusinessAssets;
import com.moaagent.agent.support.Json;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class BusinessAssetsTest {
 @TempDir Path root;
 void copyExample() throws Exception {Path source=Path.of("../examples/idou");try(var paths=Files.walk(source)){for(Path from:paths.toList()){Path to=root.resolve(source.relativize(from));if(Files.isDirectory(from))Files.createDirectories(to);else Files.copy(from,to);}}}
 @Test void loadsSelectedSkillAndInjectsFixedConfiguration() throws Exception {
  copyExample();var assets=new BusinessAssets(root);var entry=assets.skill("benefits");
  assertEquals(Set.of("balance","gifts","redeem","receipt","finish"),entry.operations().keySet());assertEquals("demo",entry.operations().get("redeem").fixedArguments().get("employeeId"));
  assertTrue(entry.operations().get("redeem").confirmationRequired());assertTrue(assets.agentTargets().containsKey("fallback"));
  assertThrows(IllegalArgumentException.class,()->assets.skill("missing"));
 }
 @Test void mappingCorrectionCreatesNewAssetsWithoutChangingExistingExecutionConfiguration() throws Exception {
  copyExample();var calls=new java.util.concurrent.atomic.AtomicInteger();
  var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/api/employees/demo/balance",exchange->{calls.incrementAndGet();byte[] body="{\"employee\":{\"wallet\":{\"availablePoints\":1280}}}".getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,body.length);exchange.getResponseBody().write(body);exchange.close();});server.start();
  try {
   var file=root.resolve("application.json");var definition=Json.object(Files.readString(file));var connections=Json.object(definition.get("connections"));connections.put("idou","http://127.0.0.1:"+server.getAddress().getPort());definition.put("connections",connections);definition.put("mapping",Map.of("balancePath","data.points.available"));Files.writeString(file,Json.write(definition));
   var oldAssets=new BusinessAssets(root);var entry=oldAssets.skill("benefits");String source=entry.assets().script(entry.operations().get("balance").resultScript());var original=oldAssets.scripts("benefits");
   assertEquals("SKILL_PROCESS_FAILED",assertThrows(IllegalStateException.class,()->original.run(null,source,Map.of())).getMessage());
   definition.put("mapping",Map.of("balancePath","employee.wallet.availablePoints"));Files.writeString(file,Json.write(definition));
   // Editing the file cannot silently repair an already loaded execution snapshot.
   assertThrows(IllegalStateException.class,()->original.run(null,source,Map.of("configuration",Map.of("mapping",Map.of("balancePath","employee.wallet.availablePoints")))));
   var corrected=new BusinessAssets(root);var result=corrected.scripts("benefits").run(null,source,Map.of());assertEquals(true,result.get("success"));assertEquals(1280,Json.object(result.get("data")).get("available"));assertEquals(3,calls.get());
  } finally {server.stop(0);}
 }
 @Test void executionRejectsMissingOperationAndCannotRemoveMandatoryRedeemConfirmation() throws Exception {
  copyExample();var ops=Json.object(Files.readString(root.resolve("adapters/operations.json")));
  var redeem=Json.object(ops.get("redeem"));redeem.put("confirmationRequired",false);ops.put("redeem",redeem);Files.writeString(root.resolve("adapters/operations.json"),Json.write(ops));
  assertThrows(IllegalArgumentException.class,()->new BusinessAssets(root));
  ops.remove("redeem");Files.writeString(root.resolve("adapters/operations.json"),Json.write(ops));assertThrows(IllegalArgumentException.class,()->new BusinessAssets(root));
 }
 @Test void invalidAgentAndEscapingAssetsAreRejected() throws Exception {
  copyExample();var definition=Json.object(Files.readString(root.resolve("application.json")));var handoff=Json.object(definition.get("handoff"));handoff.put("target","unknown");definition.put("handoff",handoff);Files.writeString(root.resolve("application.json"),Json.write(definition));assertThrows(IllegalArgumentException.class,()->new BusinessAssets(root));
  rejectEscapingCatalog();
 }
 void rejectEscapingCatalog() throws Exception {
  var definition=Json.object(Files.readString(root.resolve("application.json")));var handoff=Json.object(definition.get("handoff"));handoff.put("target","fallback");definition.put("handoff",handoff);Files.writeString(root.resolve("application.json"),Json.write(definition));
  Files.delete(root.resolve("adapters/operations.json"));Files.createSymbolicLink(root.resolve("adapters/operations.json"),Path.of("/etc/passwd"));assertThrows(IllegalArgumentException.class,()->new BusinessAssets(root));
 }
}
