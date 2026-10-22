package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Read-only equipment query adapter over a bound transport.
 *
 * <p>The transport owns HTTP, authentication references, identity and timeouts; this adapter
 * never accepts credentials, identity or endpoints from model arguments.</p>
 */
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
    if (!isValidInput(inputs)) {
      throw new IllegalArgumentException(INPUT_ERROR);
    }

    Object response = transport.invoke(inputs, kwargs);

    if (!(response instanceof Map)) {
      throw new IllegalStateException(RESPONSE_ERROR);
    }

    Map<?, ?> raw = (Map<?, ?>) response;
    Object equipmentId = raw.get("equipmentId");
    Object status = raw.get("status");
    Object temperatureCelsius = raw.get("temperatureCelsius");
    Object source = raw.get("source");

    if (!(equipmentId instanceof String)
        || !(status instanceof String)
        || !(temperatureCelsius instanceof Integer || temperatureCelsius instanceof Long)
        || !(source instanceof String)) {
      throw new IllegalStateException(RESPONSE_ERROR);
    }

    Map<String, Object> report = new LinkedHashMap<String, Object>();
    report.put("equipmentId", equipmentId);
    report.put("status", status);
    report.put("temperatureCelsius", temperatureCelsius);
    report.put("source", source);
    return report;
  }

  private static boolean isValidInput(Map<String, Object> inputs) {
    if (inputs == null || inputs.size() != 1 || !inputs.containsKey("equipmentId")) {
      return false;
    }
    Object equipmentId = inputs.get("equipmentId");
    return equipmentId instanceof String && !((String) equipmentId).trim().isEmpty();
  }
}
