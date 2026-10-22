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
  protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs)
      throws Exception {
    if (inputs == null || inputs.size() != 1 || !inputs.containsKey("equipmentId")) {
      throw new IllegalArgumentException(INPUT_ERROR);
    }
    Object equipmentId = inputs.get("equipmentId");
    if (!(equipmentId instanceof String) || ((String) equipmentId).trim().isEmpty()) {
      throw new IllegalArgumentException(INPUT_ERROR);
    }

    Object raw = transport.invoke(inputs, kwargs);
    if (!(raw instanceof Map<?, ?>)) {
      throw new IllegalStateException(RESPONSE_ERROR);
    }
    Map<?, ?> response = (Map<?, ?>) raw;

    Object responseEquipmentId = response.get("equipmentId");
    Object status = response.get("status");
    Object temperature = response.get("temperatureCelsius");
    Object source = response.get("source");

    if (!(responseEquipmentId instanceof String)
        || !(status instanceof String)
        || !(temperature instanceof Integer || temperature instanceof Long)
        || !(source instanceof String)) {
      throw new IllegalStateException(RESPONSE_ERROR);
    }

    Map<String, Object> report = new LinkedHashMap<>();
    report.put("equipmentId", responseEquipmentId);
    report.put("status", status);
    report.put("temperatureCelsius", temperature);
    report.put("source", source);
    return report;
  }
}
