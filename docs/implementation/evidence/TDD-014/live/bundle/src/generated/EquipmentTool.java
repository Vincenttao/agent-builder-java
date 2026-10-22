package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Read-only equipment query adapter over a transport Tool.
 * The transport owns HTTP, auth references and timeout; model arguments can
 * never inject identity or endpoint values.
 */
public final class EquipmentTool extends Tool {
    private static final String INPUT_CONTRACT_INVALID = "TOOL_INPUT_CONTRACT_INVALID";
    private static final String RESPONSE_CONTRACT_INVALID = "TOOL_RESPONSE_CONTRACT_INVALID";
    private static final String EQUIPMENT_ID = "equipmentId";

    private final Tool transport;

    public EquipmentTool(Tool transport) {
        super(transport.getCard());
        this.transport = transport;
    }

    @Override
    protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs) throws Exception {
        // The SDK normalizes null maps, but keep this defensive and explicit.
        Map<String, Object> safeInputs = inputs == null ? Collections.<String, Object>emptyMap() : inputs;

        // Exactly one accepted input field: a nonblank string equipmentId.
        if (safeInputs.size() != 1 || !safeInputs.containsKey(EQUIPMENT_ID)) {
            throw new IllegalArgumentException(INPUT_CONTRACT_INVALID);
        }
        Object equipmentId = safeInputs.get(EQUIPMENT_ID);
        if (!(equipmentId instanceof String) || ((String) equipmentId).trim().isEmpty()) {
            throw new IllegalArgumentException(INPUT_CONTRACT_INVALID);
        }

        // Trusted runtime kwargs are preserved untouched for the transport.
        Map<String, Object> safeKwargs = kwargs == null
                ? Collections.<String, Object>emptyMap() : kwargs;

        // Transport exceptions propagate unchanged; no retry and no fabrication.
        Object raw = transport.invoke(safeInputs, safeKwargs);

        if (!(raw instanceof Map)) {
            throw new IllegalStateException(RESPONSE_CONTRACT_INVALID);
        }
        Map<?, ?> response = (Map<?, ?>) raw;
        Object returnedId = response.get(EQUIPMENT_ID);
        Object status = response.get("status");
        Object temperature = response.get("temperatureCelsius");
        Object source = response.get("source");

        if (!(returnedId instanceof String)
                || !(status instanceof String)
                || !(source instanceof String)) {
            throw new IllegalStateException(RESPONSE_CONTRACT_INVALID);
        }
        // Only Integer or Long are accepted; never coerce strings or other numbers.
        if (!(temperature instanceof Integer) && !(temperature instanceof Long)) {
            throw new IllegalStateException(RESPONSE_CONTRACT_INVALID);
        }

        // Return only the four original contract fields, discarding anything else.
        Map<String, Object> result = new LinkedHashMap<String, Object>();
        result.put(EQUIPMENT_ID, returnedId);
        result.put("status", status);
        result.put("temperatureCelsius", temperature);
        result.put("source", source);
        return result;
    }
}
