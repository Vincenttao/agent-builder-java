package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Read-only adapter around the bound equipment transport tool.
 *
 * <p>The transport owns HTTP, authentication references and timeouts. This tool accepts only a
 * single model-facing argument, {@code equipmentId}, and never accepts credentials, identity or
 * endpoint values from model arguments. Runtime kwargs are forwarded untouched.
 */
public final class EquipmentTool extends Tool {

  private static final String INVALID_INPUT = "TOOL_INPUT_CONTRACT_INVALID";
  private static final String INVALID_RESPONSE = "TOOL_RESPONSE_CONTRACT_INVALID";
  private static final String EQUIPMENT_ID = "equipmentId";
  private static final String STATUS = "status";
  private static final String TEMPERATURE = "temperatureCelsius";
  private static final String SOURCE = "source";

  private final Tool transport;

  public EquipmentTool(Tool transport) {
    super(transport.getCard());
    this.transport = transport;
  }

  @Override
  protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs)
      throws Exception {
    validateInputs(inputs);
    Object raw = transport.invoke(inputs, kwargs);
    return validateResponse(raw);
  }

  private static void validateInputs(Map<String, Object> inputs) {
    if (inputs == null || inputs.size() != 1 || !inputs.containsKey(EQUIPMENT_ID)) {
      throw new IllegalArgumentException(INVALID_INPUT);
    }
    Object equipmentId = inputs.get(EQUIPMENT_ID);
    if (!(equipmentId instanceof String) || ((String) equipmentId).trim().isEmpty()) {
      throw new IllegalArgumentException(INVALID_INPUT);
    }
  }

  private static Map<String, Object> validateResponse(Object raw) {
    if (!(raw instanceof Map)) {
      throw new IllegalStateException(INVALID_RESPONSE);
    }
    Map<?, ?> response = (Map<?, ?>) raw;
    Object equipmentId = response.get(EQUIPMENT_ID);
    Object status = response.get(STATUS);
    Object temperature = response.get(TEMPERATURE);
    Object source = response.get(SOURCE);
    if (!(equipmentId instanceof String)
        || !(status instanceof String)
        || !(temperature instanceof Integer || temperature instanceof Long)
        || !(source instanceof String)) {
      throw new IllegalStateException(INVALID_RESPONSE);
    }
    Map<String, Object> report = new LinkedHashMap<String, Object>();
    report.put(EQUIPMENT_ID, equipmentId);
    report.put(STATUS, status);
    report.put(TEMPERATURE, temperature);
    report.put(SOURCE, source);
    return report;
  }
}
