export const generatedUnit=`package generated;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.Map;
public final class EquipmentToolTest {
 static final class Transport extends Tool {
  Transport(){super(new ToolCard("fixture","get_equipment","fixture",Map.of()));}
  protected Object invokeInternal(Map<String,Object> input,Map<String,Object> context){return Map.of("equipmentId","PUMP-001","status","warning","temperatureCelsius",86,"source","seed@1");}
 }
 public static void main(String[] args)throws Exception{
  Object actual=new EquipmentTool(new Transport()).invoke(Map.of("equipmentId","PUMP-001"));
  if(!actual.equals(Map.of("equipmentId","PUMP-001","status","warning","temperatureCelsius",86,"source","seed@1")))throw new AssertionError("temperature mapping");
  System.out.println("GENERATED_UNIT_OK");
 }
}
`;
export const generatedTool=`package generated;
import com.openjiuwen.core.foundation.tool.Tool;
import java.util.Map;
import java.util.Set;
public final class EquipmentTool extends Tool {
 private final Tool transport;
 public EquipmentTool(Tool transport){super(transport.getCard());this.transport=transport;}
 protected Object invokeInternal(Map<String,Object> input,Map<String,Object> context)throws Exception{
  if(input==null||!input.keySet().equals(Set.of("equipmentId"))||!(input.get("equipmentId") instanceof String id)||id.isBlank())throw new IllegalArgumentException("TOOL_INPUT_CONTRACT_INVALID");
  Object response=transport.invoke(input,context);
  if(!(response instanceof Map<?,?> data)||!(data.get("equipmentId") instanceof String)||!(data.get("status") instanceof String)||!(data.get("source") instanceof String)||!(data.get("temperatureCelsius") instanceof Integer||data.get("temperatureCelsius") instanceof Long))throw new IllegalStateException("TOOL_RESPONSE_CONTRACT_INVALID");
  return Map.of("equipmentId",data.get("equipmentId"),"status",data.get("status"),"temperatureCelsius",data.get("temperatureCelsius"),"source",data.get("source"));
 }
}
`;
export const generatedSkill=`---
name: equipment-query
description: Query the current equipment state through the registered Tool.
---
Ask for equipmentId if missing. Call get_equipment exactly with equipmentId. Report equipmentId, status, temperatureCelsius and source from actual tool output. On an invalid response or timeout, report the error; never invent measurements or retry a write operation.
`;
