package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

public final class EquipmentToolTest {

  private static final String INVALID_INPUT = "TOOL_INPUT_CONTRACT_INVALID";
  private static final String INVALID_RESPONSE = "TOOL_RESPONSE_CONTRACT_INVALID";

  public static void main(String[] args) throws Exception {
    verifyNormalQuery();
    verifyMissingId();
    verifyBlankId();
    verifyNullInputs();
    verifyExtraFieldsRejected();
    verifyWrongIdTypeRejected();
    verifyNonMapResponseRejected();
    verifyMissingResponseFieldRejected();
    verifyWrongResponseTypeRejected();
    verifyExtraResponseFieldsDropped();
    verifyTemperatureValuesPreserved();
    verifyTransportExceptionPropagates();
    System.out.println("EquipmentToolTest PASSED");
  }

  private static void verifyNormalQuery() throws Exception {
    RecordingTransport transport = new RecordingTransport(validResponse(), null);
    EquipmentTool tool = new EquipmentTool(transport);
    check(tool.getCard() != null, "constructor must retain a tool card");
    check(tool.getCard().equals(transport.getCard()), "constructor must retain transport.getCard()");

    Map<String, Object> inputs = new LinkedHashMap<String, Object>();
    inputs.put("equipmentId", "PUMP-001");
    Map<String, Object> kwargs = new LinkedHashMap<String, Object>();
    kwargs.put("traceId", "trace-1");
    kwargs.put("tenantId", "tenant-a");

    Object raw = tool.invokeInternal(inputs, kwargs);
    check(raw instanceof Map, "valid response must return a Map");
    Map<?, ?> out = (Map<?, ?>) raw;
    check(out.size() == 4, "output must contain exactly four fields, got " + out);
    check(Set.of("equipmentId", "status", "temperatureCelsius", "source").equals(out.keySet()),
        "output must contain only the four original fields, got " + out.keySet());
    check("PUMP-001".equals(out.get("equipmentId")), "equipmentId must be preserved");
    check("warning".equals(out.get("status")), "status must be preserved");
    check(Integer.valueOf(86).equals(out.get("temperatureCelsius")), "temperature must be preserved");
    check("seed-equipment-001@1".equals(out.get("source")), "source must be preserved");
    check(transport.callCount == 1, "transport must be called exactly once, got " + transport.callCount);
    check(inputs.equals(transport.inputsSeen), "transport must receive the validated inputs unchanged");
    check(kwargs.equals(transport.kwargsSeen), "trusted runtime kwargs must be preserved");
  }

  private static void verifyMissingId() throws Exception {
    RecordingTransport transport = new RecordingTransport(validResponse(), null);
    EquipmentTool tool = new EquipmentTool(transport);
    expectFailure(() -> tool.invokeInternal(new LinkedHashMap<String, Object>(), new LinkedHashMap<String, Object>()),
        IllegalArgumentException.class, INVALID_INPUT);
    check(transport.callCount == 0, "invalid inputs must never reach the transport");
  }

  private static void verifyBlankId() throws Exception {
    RecordingTransport transport = new RecordingTransport(validResponse(), null);
    EquipmentTool tool = new EquipmentTool(transport);
    Map<String, Object> inputs = new LinkedHashMap<String, Object>();
    inputs.put("equipmentId", "   ");
    expectFailure(() -> tool.invokeInternal(inputs, new LinkedHashMap<String, Object>()),
        IllegalArgumentException.class, INVALID_INPUT);
    check(transport.callCount == 0, "blank equipmentId must never reach the transport");
  }

  private static void verifyNullInputs() throws Exception {
    RecordingTransport transport = new RecordingTransport(validResponse(), null);
    EquipmentTool tool = new EquipmentTool(transport);
    expectFailure(() -> tool.invokeInternal(null, new LinkedHashMap<String, Object>()),
        IllegalArgumentException.class, INVALID_INPUT);
    check(transport.callCount == 0, "null inputs must never reach the transport");
  }

  private static void verifyExtraFieldsRejected() throws Exception {
    RecordingTransport transport = new RecordingTransport(validResponse(), null);
    EquipmentTool tool = new EquipmentTool(transport);
    Map<String, Object> withActor = new LinkedHashMap<String, Object>();
    withActor.put("equipmentId", "PUMP-001");
    withActor.put("actorId", "admin");
    expectFailure(() -> tool.invokeInternal(withActor, new LinkedHashMap<String, Object>()),
        IllegalArgumentException.class, INVALID_INPUT);

    Map<String, Object> withEndpoint = new LinkedHashMap<String, Object>();
    withEndpoint.put("equipmentId", "PUMP-001");
    withEndpoint.put("endpoint", "http://evil.invalid");
    expectFailure(() -> tool.invokeInternal(withEndpoint, new LinkedHashMap<String, Object>()),
        IllegalArgumentException.class, INVALID_INPUT);
    check(transport.callCount == 0, "extra input fields must never reach the transport");
  }

  private static void verifyWrongIdTypeRejected() throws Exception {
    RecordingTransport transport = new RecordingTransport(validResponse(), null);
    EquipmentTool tool = new EquipmentTool(transport);
    Map<String, Object> inputs = new LinkedHashMap<String, Object>();
    inputs.put("equipmentId", Integer.valueOf(1));
    expectFailure(() -> tool.invokeInternal(inputs, new LinkedHashMap<String, Object>()),
        IllegalArgumentException.class, INVALID_INPUT);
    check(transport.callCount == 0, "non-string equipmentId must never reach the transport");
  }

  private static void verifyNonMapResponseRejected() throws Exception {
    RecordingTransport transport = new RecordingTransport("PUMP-001 is fine", null);
    EquipmentTool tool = new EquipmentTool(transport);
    Map<String, Object> inputs = new LinkedHashMap<String, Object>();
    inputs.put("equipmentId", "PUMP-001");
    expectFailure(() -> tool.invokeInternal(inputs, new LinkedHashMap<String, Object>()),
        IllegalStateException.class, INVALID_RESPONSE);
  }

  private static void verifyMissingResponseFieldRejected() throws Exception {
    Map<String, Object> response = validResponse();
    response.remove("source");
    RecordingTransport transport = new RecordingTransport(response, null);
    EquipmentTool tool = new EquipmentTool(transport);
    Map<String, Object> inputs = new LinkedHashMap<String, Object>();
    inputs.put("equipmentId", "PUMP-001");
    expectFailure(() -> tool.invokeInternal(inputs, new LinkedHashMap<String, Object>()),
        IllegalStateException.class, INVALID_RESPONSE);
  }

  private static void verifyWrongResponseTypeRejected() throws Exception {
    Map<String, Object> stringTemperature = validResponse();
    stringTemperature.put("temperatureCelsius", "86");
    RecordingTransport stringTempTransport = new RecordingTransport(stringTemperature, null);
    EquipmentTool stringTempTool = new EquipmentTool(stringTempTransport);
    Map<String, Object> inputs = new LinkedHashMap<String, Object>();
    inputs.put("equipmentId", "PUMP-001");
    expectFailure(() -> stringTempTool.invokeInternal(inputs, new LinkedHashMap<String, Object>()),
        IllegalStateException.class, INVALID_RESPONSE);

    Map<String, Object> numericStatus = validResponse();
    numericStatus.put("status", Integer.valueOf(2));
    RecordingTransport numericStatusTransport = new RecordingTransport(numericStatus, null);
    EquipmentTool numericStatusTool = new EquipmentTool(numericStatusTransport);
    expectFailure(() -> numericStatusTool.invokeInternal(inputs, new LinkedHashMap<String, Object>()),
        IllegalStateException.class, INVALID_RESPONSE);
  }

  private static void verifyExtraResponseFieldsDropped() throws Exception {
    Map<String, Object> response = validResponse();
    response.put("internalSecret", "do-not-leak");
    response.put("credentialRef", "secret-ref");
    RecordingTransport transport = new RecordingTransport(response, null);
    EquipmentTool tool = new EquipmentTool(transport);
    Map<String, Object> inputs = new LinkedHashMap<String, Object>();
    inputs.put("equipmentId", "PUMP-001");
    Object raw = tool.invokeInternal(inputs, new LinkedHashMap<String, Object>());
    check(raw instanceof Map, "response must be returned as a Map");
    Map<?, ?> out = (Map<?, ?>) raw;
    check(out.size() == 4, "only the four original fields may be returned, got " + out);
    check(!out.containsKey("internalSecret"), "internalSecret must not leak");
    check(!out.containsKey("credentialRef"), "credentialRef must not leak");
  }

  private static void verifyTemperatureValuesPreserved() throws Exception {
    Map<String, Object> negative = validResponse();
    negative.put("temperatureCelsius", Long.valueOf(-12L));
    RecordingTransport negativeTransport = new RecordingTransport(negative, null);
    EquipmentTool negativeTool = new EquipmentTool(negativeTransport);
    Map<String, Object> inputs = new LinkedHashMap<String, Object>();
    inputs.put("equipmentId", "PUMP-001");
    Object rawNegative = negativeTool.invokeInternal(inputs, new LinkedHashMap<String, Object>());
    check(rawNegative instanceof Map, "response must be returned as a Map");
    check(Long.valueOf(-12L).equals(((Map<?, ?>) rawNegative).get("temperatureCelsius")),
        "negative temperature must be preserved exactly");

    Map<String, Object> zero = validResponse();
    zero.put("temperatureCelsius", Integer.valueOf(0));
    RecordingTransport zeroTransport = new RecordingTransport(zero, null);
    EquipmentTool zeroTool = new EquipmentTool(zeroTransport);
    Object rawZero = zeroTool.invokeInternal(inputs, new LinkedHashMap<String, Object>());
    check(Integer.valueOf(0).equals(((Map<?, ?>) rawZero).get("temperatureCelsius")),
        "zero temperature must be preserved exactly");
  }

  private static void verifyTransportExceptionPropagates() throws Exception {
    IllegalStateException failure = new IllegalStateException("transport read timeout");
    RecordingTransport transport = new RecordingTransport(validResponse(), failure);
    EquipmentTool tool = new EquipmentTool(transport);
    Map<String, Object> inputs = new LinkedHashMap<String, Object>();
    inputs.put("equipmentId", "PUMP-001");
    try {
      tool.invokeInternal(inputs, new LinkedHashMap<String, Object>());
      throw new AssertionError("transport failure must propagate");
    } catch (IllegalStateException caught) {
      check(caught == failure, "transport exception must propagate unchanged");
    }
    check(transport.callCount == 1, "transport must be attempted exactly once");
  }

  private static Map<String, Object> validResponse() {
    Map<String, Object> response = new LinkedHashMap<String, Object>();
    response.put("equipmentId", "PUMP-001");
    response.put("status", "warning");
    response.put("temperatureCelsius", Integer.valueOf(86));
    response.put("source", "seed-equipment-001@1");
    return response;
  }

  private static void check(boolean condition, String message) {
    if (!condition) {
      throw new AssertionError(message);
    }
  }

  private static void expectFailure(Action action, Class<? extends Throwable> type, String message)
      throws Exception {
    try {
      action.run();
    } catch (Throwable thrown) {
      if (!type.isInstance(thrown)) {
        throw new AssertionError("expected " + type.getName() + " but got " + thrown, thrown);
      }
      check(message.equals(thrown.getMessage()),
          "expected message " + message + " but got " + thrown.getMessage());
      return;
    }
    throw new AssertionError("expected " + type.getName() + " but nothing was thrown");
  }

  private interface Action {
    Object run() throws Exception;
  }

  private static final class RecordingTransport extends Tool {
    private final Object response;
    private final RuntimeException failure;
    private int callCount;
    private Map<String, Object> inputsSeen;
    private Map<String, Object> kwargsSeen;

    private RecordingTransport(Object response, RuntimeException failure) {
      super(new ToolCard("test-transport", "test-transport",
          "recording transport for EquipmentToolTest", new LinkedHashMap<String, Object>()));
      this.response = response;
      this.failure = failure;
    }

    @Override
    protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs) {
      callCount++;
      inputsSeen = inputs;
      kwargsSeen = kwargs;
      if (failure != null) {
        throw failure;
      }
      return response;
    }
  }
}
