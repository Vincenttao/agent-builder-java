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
