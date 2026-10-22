package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import java.util.LinkedHashMap;
import java.util.Map;

public final class EquipmentTool extends Tool {

  private static final String INPUT_ERROR = "TOOL_INPUT_CONTRACT_INVALID";
  private static final String RESPONSE_ERROR = "TOOL_RESPONSE_CONTRACT_INVALID";

  private final Tool transport;

  public EquipmentTool(Tool transport) {
    super(transport.getCard());
    this.transport = transport;
  }

  @Override
  protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs) throws Exception {
    Map<String, Object> safeInputs = inputs == null ? new LinkedHashMap<String, Object>() : inputs;
    Map<String, Object> safeKwargs = kwargs == null ? new LinkedHashMap<String, Object>() : kwargs;

    if (safeInputs.size() != 1 || !safeInputs.containsKey("equipmentId")) {
      throw new IllegalArgumentException(INPUT_ERROR);
    }
    Object equipmentId = safeInputs.get("equipmentId");
    if (!(equipmentId instanceof String) || ((String) equipmentId).trim().isEmpty()) {
      throw new IllegalArgumentException(INPUT_ERROR);
    }

    Object response = transport.invoke(safeInputs, safeKwargs);
    if (!(response instanceof Map)) {
      throw new IllegalStateException(RESPONSE_ERROR);
    }
    Map<?, ?> raw = (Map<?, ?>) response;
    Object outEquipmentId = raw.get("equipmentId");
    Object status = raw.get("status");
    Object temperature = raw.get("temperatureCelsius");
    Object source = raw.get("source");

    if (!(outEquipmentId instanceof String)
        || !(status instanceof String)
        || !(temperature instanceof Integer || temperature instanceof Long)
        || !(source instanceof String)) {
      throw new IllegalStateException(RESPONSE_ERROR);
    }

    Map<String, Object> result = new LinkedHashMap<String, Object>();
    result.put("equipmentId", outEquipmentId);
    result.put("status", status);
    result.put("temperatureCelsius", temperature);
    result.put("source", source);
    return result;
  }
}
