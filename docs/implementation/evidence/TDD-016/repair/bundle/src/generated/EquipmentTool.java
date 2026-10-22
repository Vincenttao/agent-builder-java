package generated;
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
