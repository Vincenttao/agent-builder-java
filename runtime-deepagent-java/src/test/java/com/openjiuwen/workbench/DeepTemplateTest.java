package com.openjiuwen.workbench;
import com.openjiuwen.workbench.deep.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
class DeepTemplateTest {
 @TempDir Path root;
 @Test void controlledReplacementPreservesEveryOtherCharacterAndRequiresFreshReadback() throws Exception {
  var events=new ArrayList<Map<String,Object>>();var tools=new ArtifactTools(root.resolve("patch"),events::add);tools.requireSelection(true);tools.beginTurn();tools.selectSkill("notes",Set.of("read_file","write_file","replace_text"));
  String original="# 项目\n负责人：王晨\n预算：3万元\n截止：6月30日\n评审：李敏（6月30日之前）\n";
  tools.write("brief.md",original);tools.read("brief.md");assertTrue(tools.verified());
  tools.beginTurn();tools.selectSkill("notes",Set.of("read_file","write_file","replace_text"));
  assertThrows(IllegalArgumentException.class,()->tools.write("brief.md","整篇重写"));
  assertThrows(IllegalArgumentException.class,()->tools.replace("brief.md","6月30日","7月5日"));
  assertEquals(original,tools.read("brief.md"));assertFalse(tools.verified());
  assertThrows(IllegalArgumentException.class,()->tools.replace("brief.md","不存在","x"));assertEquals(original,Files.readString(root.resolve("patch/brief.md")));
  var result=tools.replace("brief.md","6月30日","7月5日");assertEquals(2,result.get("replacements"));assertFalse(tools.verified());assertEquals(original.replace("6月30日","7月5日"),tools.read("brief.md"));assertTrue(tools.verified());
  assertTrue(events.stream().anyMatch(e->e.get("type").equals("artifact_patched")));
  tools.beginTurn();tools.selectSkill("notes",Set.of("read_file"));assertThrows(IllegalArgumentException.class,()->tools.replace("brief.md","7月5日","x"));
 }
 @Test void controlledReplacementRejectsStaleReadAndKeepsLegacyWriteOnlyAssemblyCompatible() throws Exception {
  var tools=new ArtifactTools(root.resolve("stale"),e->{});tools.write("brief.md","原始内容");tools.read("brief.md");Files.writeString(root.resolve("stale/brief.md"),"外部修改");assertThrows(IllegalArgumentException.class,()->tools.replace("brief.md","原始","新"));assertEquals("外部修改",Files.readString(root.resolve("stale/brief.md")));
  tools.requireSelection(true);tools.beginTurn();tools.selectSkill("legacy",Set.of("read_file","write_file"));tools.write("brief.md","兼容旧装配");assertEquals("兼容旧装配",tools.read("brief.md"));assertTrue(tools.verified());
 }
 @Test void replacementExpansionIsRejectedBeforeConstructingAnUnboundedOutput() {
  var tools=new ArtifactTools(root.resolve("bounded"),e->{});String text="a".repeat(50000);tools.write("brief.md",text);tools.read("brief.md");assertThrows(IllegalArgumentException.class,()->tools.replace("brief.md","a","b".repeat(50000)));assertEquals(text,tools.read("brief.md"));
 }
 @Test void fileToolsEnforceOneArtifactAndRequireReadAfterWrite() throws Exception {
  var tools=new ArtifactTools(root.resolve("workspace"),e->{});tools.beginTurn();
  assertThrows(IllegalArgumentException.class,()->tools.write("../escape.md","x"));
  assertThrows(IllegalArgumentException.class,()->tools.write("other.md","x"));
  tools.write("brief.md","# 初稿");assertFalse(tools.verified());assertEquals("# 初稿",tools.read("brief.md"));assertTrue(tools.verified());
  tools.beginTurn();assertFalse(tools.verified());tools.read("brief.md");assertFalse(tools.verified());
  tools.write("brief.md","# 修改稿");assertFalse(tools.verified());tools.read("brief.md");assertTrue(tools.verified());
  Files.delete(root.resolve("workspace/brief.md"));Files.createSymbolicLink(root.resolve("workspace/brief.md"),root.resolve("outside.md"));
  assertThrows(IllegalArgumentException.class,()->tools.write("brief.md","escape"));assertFalse(Files.exists(root.resolve("outside.md")));
 }
 @Test void savedArtifactAndReadbackAreRequiredForCompletionAndConversationsAreIsolated() {
  var host=new DeepHost(root,(id,tools)->new DeepHost.Executor(){public Map<String,Object> invoke(String q){tools.write("brief.md",q.contains("更新")?tools.read("brief.md")+"\n更新：下周一":q);tools.read("brief.md");return Map.of("content","ARTIFACTS_READY");}public void close(){} });
  var a=host.reserve();String id=(String)a.get("conversationId");var first=host.message(id,"整理：登录已完成，支付排查周五完成");assertEquals("COMPLETED",((Map<?,?>)((List<?>)first.get("tasks")).get(0)).get("state"));
  var next=host.message(id,"更新截止日");assertTrue(next.toString().contains("登录已完成"));assertTrue(next.toString().contains("下周一"));
  var other=host.reserve();assertFalse(host.view((String)other.get("conversationId")).toString().contains("登录已完成"));host.close();
 }
 @Test void assembledSkillControlsToolSetAndRejectsUnknownSkill() throws Exception {
  var tools=new ArtifactTools(root.resolve("assembled"),e->{});var assembly=new SkillAssembly(Map.of("read-only",new SkillAssembly.Skill("read-only","只读指导",Set.of("read_file"))));var skillTool=(com.openjiuwen.core.foundation.tool.Tool)assembly.tools(tools).get(0);tools.beginTurn();assertThrows(IllegalArgumentException.class,()->tools.write("brief.md","x"));Object unknown=skillTool.invoke(Map.of("skill_name","unmounted"));assertTrue(unknown.toString().contains("SKILL_NOT_ASSEMBLED"));skillTool.invoke(Map.of("skill_name","read-only"));assertThrows(IllegalArgumentException.class,()->tools.write("brief.md","x"));tools.beginTurn();assertThrows(IllegalArgumentException.class,()->tools.read("brief.md"));
 }
 @Test void missingTurnSkillReturnsRecoverableToolResultWithoutGrantingAccess() throws Exception {
  var files=new ArtifactTools(root.resolve("recovery"),e->{});files.requireSelection(true);files.beginTurn();for(Object raw:files.tools()){var tool=(com.openjiuwen.core.foundation.tool.Tool)raw;Object response=tool.invoke(tool.getCard().getName().equals("list_files")?Map.of():tool.getCard().getName().equals("write_file")?Map.of("file_path","brief.md","content","x"):tool.getCard().getName().equals("replace_text")?Map.of("file_path","brief.md","old_text","x","new_text","y"):Map.of("file_path","brief.md"));assertTrue(response.toString().contains("SKILL_LOAD_REQUIRED_THIS_TURN"),response.toString());assertTrue(response.toString().contains("skill_tool"));}assertFalse(Files.exists(root.resolve("recovery/brief.md")));files.selectSkill("reader",Set.of("read_file"));assertThrows(IllegalArgumentException.class,()->files.write("brief.md","blocked"));
 }
 @Test void failedFollowupIsRecordedAsFailedRatherThanShowingPreviousSuccess(){
  var host=new DeepHost(root,(id,tools)->new DeepHost.Executor(){public Map<String,Object> invoke(String q){if(q.equals("fail"))throw new IllegalStateException("simulated");tools.write("brief.md","原稿");tools.read("brief.md");return Map.of("content","ARTIFACTS_READY");}public void close(){}});String id=(String)host.reserve().get("conversationId");host.message(id,"first");assertThrows(IllegalStateException.class,()->host.message(id,"fail"));var view=host.view(id);var tasks=(List<?>)view.get("tasks");assertEquals(2,tasks.size());assertEquals("FAILED",((Map<?,?>)tasks.get(1)).get("state"));assertFalse((Boolean)view.get("busy"));host.close();
 }
 @Test void nativeFactoryUsesRealCoreAndClosesWithoutModelCalls(){
  var tools=new ArtifactTools(root.resolve("factory"),e->{});var instance=DeepFactory.create("factory-test",root.resolve("factory"),"维护brief.md，完成时输出<promise>ARTIFACTS_READY</promise>",new ModelConfiguration("unused-test-credential","http://127.0.0.1:1/v1","fixture-model"),tools);instance.close();
 }
 @Test void modelClaimAloneDoesNotCompleteWork() {
  var host=new DeepHost(root,(id,tools)->new DeepHost.Executor(){public Map<String,Object> invoke(String q){return Map.of("content","ARTIFACTS_READY");}public void close(){} });
  String id=(String)host.reserve().get("conversationId");var result=host.message(id,"输入");assertTrue(result.toString().contains("ARTIFACT_NOT_VERIFIED"));assertFalse(result.toString().contains("state=COMPLETED"));host.close();
 }
}
