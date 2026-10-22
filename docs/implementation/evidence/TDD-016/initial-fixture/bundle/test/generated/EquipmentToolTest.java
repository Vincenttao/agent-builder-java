package generated;
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
