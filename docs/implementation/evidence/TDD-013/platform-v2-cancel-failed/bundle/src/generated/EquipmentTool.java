package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Tool adapter for the bound equipment transport.
 *
 * <p>The transport owns HTTP, credentials, identity and timeouts. This adapter only
 * accepts the business input {@code equipmentId} and forwards trusted runtime kwargs.
 */
public final class EquipmentTool extends Tool {

  private static final String INPUT_ERROR = "TOOL_INPUT_CONTRACT_INVALID";
  private static final String RESPONSE_ERROR = "TOOL_RESPONSE_CONTRACT_INVALID";
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

    // Trusted runtime kwargs are passed through unchanged; transport exceptions
    // intentionally propagate to the caller without wrapping or retrying.
    Object response = transport.invoke(inputs, kwargs);

    return validateResponse(response);
  }

  private static void validateInputs(Map<String, Object> inputs) {
    if (inputs == null || inputs.size() != 1 || !inputs.containsKey(EQUIPMENT_ID)) {
      throw new IllegalArgumentException(INPUT_ERROR);
    }
    Object equipmentId = inputs.get(EQUIPMENT_ID);
    if (!(equipmentId instanceof String) || ((String) equipmentId).trim().isEmpty()) {
      throw new IllegalArgumentException(INPUT_ERROR);
    }
  }

  private static Map<String, Object> validateResponse(Object response) {
    if (!(response instanceof Map)) {
      throw new IllegalStateException(RESPONSE_ERROR);
    }
    Map<?, ?> source = (Map<?, ?>) response;
    if (!source.containsKey(EQUIPMENT_ID)
        || !source.containsKey(STATUS)
        || !source.containsKey(TEMPERATURE)
        || !source.containsKey(SOURCE)) {
      throw new IllegalStateException(RESPONSE_ERROR);
    }

    Object equipmentId = source.get(EQUIPMENT_ID);
    Object status = source.get(STATUS);
    Object temperature = source.get(TEMPERATURE);
    Object origin = source.get(SOURCE);

    if (!(equipmentId instanceof String)
        || !(status instanceof String)
        || !(temperature instanceof Integer || temperature instanceof Long)
        || !(origin instanceof String)) {
      throw new IllegalStateException(RESPONSE_ERROR);
    }

    // Return only the four original fields, preserving values and numeric types.
    Map<String, Object> result = new LinkedHashMap<String, Object>();
    result.put(EQUIPMENT_ID, equipmentId);
    result.put(STATUS, status);
    result.put(TEMPERATURE, temperature);
    result.put(SOURCE, origin);
    return result;
  }
}
