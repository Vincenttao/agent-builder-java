package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.LinkedHashMap;
import java.util.Map;

public final class EquipmentRepair1Test {

 static final class RecordingTransport extends Tool {
  Map<String,Object> seenInput;
  RecordingTransport(){super(new ToolCard("fixture","get_equipment","fixture",Map.of()));}
  protected Object invokeInternal(Map<String,Object> input,Map<String,Object> context){
   seenInput=new LinkedHashMap<String,Object>(input);
   Map<String,Object> data=new LinkedHashMap<String,Object>();
   data.put("equipmentId","PUMP-001");
   data.put("status","warning");
   data.put("temperatureCelsius",86);
   data.put("source","seed-equipment-001@1");
   return data;
  }
 }

 public static void main(String[] args)throws Exception{
  RecordingTransport transport=new RecordingTransport();
  Map<String,Object> expected=new LinkedHashMap<String,Object>();
  expected.put("equipmentId","PUMP-001");
  expected.put("status","warning");
  expected.put("temperatureCelsius",86);
  expected.put("source","seed-equipment-001@1");

  Object actual=new EquipmentTool(transport).invoke(Map.of("equipmentId","PUMP-001"));
  if(!(actual instanceof Map<?,?> actualMap))throw new AssertionError("REPAIR_REGRESSION_FAILED: tool output must be a map");
  if(!expected.equals(actualMap))throw new AssertionError("REPAIR_REGRESSION_FAILED: equipment facts must equal "+expected+" but were "+actualMap);
  Object temperature=actualMap.get("temperatureCelsius");
  if(!(temperature instanceof Integer)||!Integer.valueOf(86).equals(temperature))throw new AssertionError("REPAIR_REGRESSION_FAILED: temperatureCelsius must be unmodified Integer 86 but was "+temperature);
  if(transport.seenInput==null||!Map.of("equipmentId","PUMP-001").equals(transport.seenInput))throw new AssertionError("REPAIR_REGRESSION_FAILED: equipmentId must be forwarded unchanged but transport saw "+transport.seenInput);
  System.out.println("REPAIR_REGRESSION_OK");
 }
}
