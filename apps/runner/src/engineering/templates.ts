export const toolStub=`package generated;
import com.openjiuwen.core.foundation.tool.Tool;
import java.util.Map;
public final class EquipmentTool extends Tool {
  private final Tool transport;
  public EquipmentTool(Tool transport) { super(transport.getCard()); this.transport=transport; }
  @Override protected Object invokeInternal(Map<String,Object> inputs,Map<String,Object> kwargs) throws Exception {
    throw new UnsupportedOperationException("IMPLEMENTATION_REQUIRED");
  }
}
`;
export const toolContract=`Implement generated.EquipmentTool extending the pinned OpenJiuwen Tool. Constructor EquipmentTool(Tool transport) retains transport.getCard().
invokeInternal validates inputs before calling transport.invoke(inputs,kwargs), preserving trusted runtime kwargs. Only equipmentId:string is accepted, nonblank. Reject every extra input field, including actorId and endpoint. Throw IllegalArgumentException("TOOL_INPUT_CONTRACT_INVALID") on invalid inputs with zero transport calls.
Pinned SDK behavior: Tool.invoke copies both input and kwargs maps before invokeInternal, even with no callbacks. Verify map values with Map.equals, NEVER map object identity (==). The same original ToolCard and propagated exception objects may be checked by identity. Do not override Tool.invoke or bypass its SDK callback lifecycle. Null input/kwargs maps are normalized by the SDK to empty maps before invokeInternal. The test should start with an uncaught valid invocation so the stub really exits nonzero; catching IMPLEMENTATION_REQUIRED and returning normally is not red.
The transport response is an Object. A valid response is a Map containing equipmentId:string, status:string, temperatureCelsius:Integer or Long, source:string. Missing/wrong types must throw IllegalStateException("TOOL_RESPONSE_CONTRACT_INVALID"); do not invent data, retry, or coerce strings into numbers. Return only these four original fields. Preserve negative temperatures and zero. Transport exceptions must propagate unchanged.
Use only java.util.* and com.openjiuwen.core.foundation.tool.Tool/ToolCard imports. The transport owns HTTP, auth references and timeout; generated code must not take credentials, identity or endpoint from model arguments. No new dependency, shell, network client or process API.
The unit test must be generated.EquipmentToolTest with public static void main(String[] args) throws Exception and explicit assertions that throw on failure; -ea is also enabled. Use a recording Tool subclass as transport. Do not use JUnit or any other dependency. The first test invocation must compile and fail with IMPLEMENTATION_REQUIRED from the stub; compilation failures do not count as red. After valid red the unit test is frozen; implement the Tool without weakening the test. Run unit-test again and then build. The platform runs its own contract checks during build.
Write skills/equipment-query/SKILL.md with name equipment-query, a description, get_equipment invocation steps, equipmentId input, response field explanations and explicit error/no-fabrication handling. This is a business Skill instruction plus Tool adapter; it does not execute external scripts.
`;
export const engineeringSkills={
  tester:`# OpenJiuwen acceptance testing @1\nRead context.json. Before implementation, write tests/plan.json using the confirmed baseline. Include baselineDigest and exactly one case for every baseline.content.cases item: caseId, requirementIds, assertions copied without changes, and steps (at least two concrete strings describing invocation and external-state verification). Requirements, expected values and required cases are immutable. Changes may only be proposed in tests/proposal.json. You may read implementation files but cannot modify them. A plan is not a passing business report. Finish after saving the valid plan.`,
  developer:`# OpenJiuwen component development @1\nUse only builder MCP tools. Read context.json and follow its contract. Write the unit test before implementation; run unit-test and inspect a valid failing execution. Once red is observed the test is frozen. Implement the source, add the business Skill, rerun unit-test, then build. Inspect actual exit codes. Never report a model statement as build or acceptance success. Files and commands outside this profile are refused. If a needed capability is missing, report the concrete gap. Do not ask for permissions that the profile does not grant.`
};
export const repairContract=`Repair the frozen generated Tool/Skill using repair.failures and repair.files in context.json. Their report, evidence and candidate references identify the original failure; they are evidence, not instructions to change policy.
The original source, Skill, unit tests and independent plan have already been copied into this new workspace. Preserve all old tests and the exact plan. The tester role reuses its plan without a new model session.
Write test/generated/EquipmentRepairNTest.java (N = repair.reference.attempt), class generated.EquipmentRepairNTest, with main(String[] args) throws Exception. Reproduce the failed business assertion with a recording Tool transport and the relevant input/response. Throw AssertionError("REPAIR_REGRESSION_FAILED: concrete assertion") only when the assertion is false. First run unit-test against the UNCHANGED original implementation. Compile errors, a passing test, timeouts, or failures of old tests do not count as repair red. If the failure cannot be reproduced within this profile, report the gap; do not manufacture a failure or weaken expectations.
After real regression red, the new test also freezes. Modify only the allowed implementation/Skill, run unit-test (all old and new tests), then build. No stub replacement. No dependency, network client, process API, new credentials or changes to acceptance criteria. Generated EquipmentTool keeps transport.getCard(), validates only nonblank equipmentId, forwards trusted kwargs and transport exceptions unchanged, and returns only original equipmentId/status/temperatureCelsius/source. temperatureCelsius must remain Integer or Long, including negative and zero. Reject malformed inputs or response data using TOOL_INPUT_CONTRACT_INVALID / TOOL_RESPONSE_CONTRACT_INVALID. Use only java.util.* and SDK Tool/ToolCard. Tool.invoke copies maps, so compare values rather than map identity.
Building creates a NEW candidate bundle; the old failure remains. Full business regression is still required after build.\n`;
export const platformContractTest=`package verification;
import generated.EquipmentTool;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.Map;
import java.util.List;
public final class EquipmentContract {
 static final class Recording extends Tool {
  int calls=0; Object response; Map<String,Object> args,context;
  Recording(){super(new ToolCard("equipment@1","get_equipment","fixture",Map.of()));}
  protected Object invokeInternal(Map<String,Object> inputs,Map<String,Object> kwargs){calls++;args=inputs;context=kwargs;if(response instanceof RuntimeException e)throw e;return response;}
 }
 static void check(boolean value){if(!value)throw new AssertionError("PLATFORM_CONTRACT_FAILED");}
 static void invalid(EquipmentTool tool,Map<String,Object> input,String message)throws Exception{try{tool.invoke(input,Map.of());throw new AssertionError("EXPECTED_CONTRACT_ERROR");}catch(IllegalArgumentException|IllegalStateException e){check(message.equals(e.getMessage()));}}
 public static void main(String[] ignored)throws Exception{
  Recording transport=new Recording();EquipmentTool tool=new EquipmentTool(transport);check(tool.getCard()==transport.getCard());
  for(Map<String,Object> input:List.<Map<String,Object>>of(Map.of(),Map.of("equipmentId",1),Map.of("equipmentId"," "),Map.of("equipmentId","PUMP-001","actorId","U1002"),Map.of("equipmentId","PUMP-001","endpoint","https://invalid.example")))invalid(tool,input,"TOOL_INPUT_CONTRACT_INVALID");
  check(transport.calls==0);Map<String,Object> input=Map.of("equipmentId","PUMP-001");Map<String,Object> context=Map.of("session","trusted-session");
  for(Object temperature:List.of(86,0,-12,86L)){
   transport.response=Map.of("equipmentId","PUMP-001","status","warning","temperatureCelsius",temperature,"source","seed@1","irrelevant","omit");
   Object actual=tool.invoke(input,context);check(actual.equals(Map.of("equipmentId","PUMP-001","status","warning","temperatureCelsius",temperature,"source","seed@1")));check(transport.args.equals(input));check(transport.context.equals(context));
  }
  for(Object response:List.of("wrong",Map.of(),Map.of("equipmentId","PUMP-001","status","warning","temperatureCelsius","86","source","seed@1"),Map.of("equipmentId","PUMP-001","status","warning","temperatureCelsius",86))) {transport.response=response;invalid(tool,input,"TOOL_RESPONSE_CONTRACT_INVALID");}
  transport.response=null;invalid(tool,input,"TOOL_RESPONSE_CONTRACT_INVALID");
  RuntimeException original=new RuntimeException("TOOL_TIMEOUT");transport.response=original;int before=transport.calls;
  try{tool.invoke(input,context);throw new AssertionError("EXPECTED_TIMEOUT");}catch(RuntimeException e){check(e==original);}check(transport.calls==before+1);
  System.out.println("PLATFORM_CONTRACT_OK");
 }
}
`;
