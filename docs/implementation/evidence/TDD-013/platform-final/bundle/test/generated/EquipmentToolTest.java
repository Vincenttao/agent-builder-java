package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class EquipmentToolTest {

  private static final class RecordingTransport extends Tool {
    final List<Map<String, Object>> calls = new ArrayList<>();
    final List<Map<String, Object>> callKwargs = new ArrayList<>();
    Object response;
    RuntimeException failure;

    RecordingTransport(ToolCard card) {
      super(card);
    }

    @Override
    protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs)
        throws Exception {
      calls.add(new LinkedHashMap<>(inputs));
      callKwargs.add(new LinkedHashMap<>(kwargs));
      if (failure != null) {
        throw failure;
      }
      return response;
    }
  }

  public static void main(String[] args) throws Exception {
    ToolCard card = new ToolCard();
    RecordingTransport transport = new RecordingTransport(card);
    EquipmentTool tool = new EquipmentTool(transport);

    check(tool.getCard() == card, "constructor must retain the transport ToolCard");

    Map<String, Object> valid = Map.of("equipmentId", "PUMP-001");
    Map<String, Object> kwargs = Map.of("traceId", "trace-1");
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("equipmentId", "PUMP-001");
    payload.put("status", "warning");
    payload.put("temperatureCelsius", 86);
    payload.put("source", "seed-equipment-001@1");
    transport.response = payload;

    Object result = tool.invoke(valid, kwargs);
    check(transport.calls.size() == 1, "valid input must call transport exactly once");
    check(transport.calls.get(0).equals(valid),
        "transport must receive the trusted input values, got " + transport.calls.get(0));
    check(transport.callKwargs.get(0).equals(kwargs),
        "trusted kwargs must be preserved, got " + transport.callKwargs.get(0));
    check(payload.equals(result), "response must expose the four original fields, got " + result);

    payload.put("extra", "dropped");
    Object trimmed = tool.invoke(valid, kwargs);
    check(Map.of(
            "equipmentId", "PUMP-001",
            "status", "warning",
            "temperatureCelsius", 86,
            "source", "seed-equipment-001@1").equals(trimmed),
        "extra response fields must not leak, got " + trimmed);
    check(transport.calls.size() == 2, "second valid input must call transport exactly once");

    transport.response = Map.of(
        "equipmentId", "PUMP-002",
        "status", "normal",
        "temperatureCelsius", 0L,
        "source", "seed-equipment-002@1");
    Object zeroLong = tool.invoke(Map.of("equipmentId", "PUMP-002"), Map.of());
    check(Long.valueOf(0L).equals(((Map<?, ?>) zeroLong).get("temperatureCelsius")),
        "zero Long temperature must be preserved");
    transport.response = Map.of(
        "equipmentId", "PUMP-003",
        "status", "cold",
        "temperatureCelsius", -12,
        "source", "seed-equipment-003@1");
    Object negative = tool.invoke(Map.of("equipmentId", "PUMP-003"), Map.of());
    check(Integer.valueOf(-12).equals(((Map<?, ?>) negative).get("temperatureCelsius")),
        "negative temperature must be preserved");

    assertInvalid(tool, transport, Map.of(), "missing equipmentId");
    assertInvalid(tool, transport, Map.of("equipmentId", "   "), "blank equipmentId");
    Map<String, Object> nullId = new LinkedHashMap<>();
    nullId.put("equipmentId", null);
    assertInvalid(tool, transport, nullId, "null equipmentId");
    assertInvalid(tool, transport, Map.of("equipmentId", 42), "non-string equipmentId");
    assertInvalid(tool, transport, Map.of("equipmentId", "PUMP-001", "actorId", "u-1"),
        "extra actorId input");
    assertInvalid(tool, transport, Map.of("equipmentId", "PUMP-001", "endpoint", "http://x"),
        "extra endpoint input");
    assertInvalid(tool, transport, Map.of("equipmentId", "PUMP-001", "temperatureCelsius", 1),
        "extra temperatureCelsius input");

    try {
      tool.invoke(null, null);
      throw new AssertionError("null input maps must be rejected as missing equipmentId");
    } catch (IllegalArgumentException expected) {
      check("TOOL_INPUT_CONTRACT_INVALID".equals(expected.getMessage()),
          "unexpected invalid-input message: " + expected.getMessage());
    }

    transport.response = Map.of(
        "equipmentId", "PUMP-001",
        "status", "warning",
        "temperatureCelsius", 86);
    assertInvalidResponse(tool, transport, "missing source");
    transport.response = Map.of(
        "equipmentId", "PUMP-001",
        "status", "warning",
        "temperatureCelsius", "86",
        "source", "seed-equipment-001@1");
    assertInvalidResponse(tool, transport, "string temperature");
    transport.response = Map.of(
        "equipmentId", "PUMP-001",
        "status", "warning",
        "temperatureCelsius", 86.5,
        "source", "seed-equipment-001@1");
    assertInvalidResponse(tool, transport, "floating temperature");
    transport.response = Map.of(
        "status", "warning",
        "temperatureCelsius", 86,
        "source", "seed-equipment-001@1");
    assertInvalidResponse(tool, transport, "missing equipmentId");
    transport.response = Map.of(
        "equipmentId", "PUMP-001",
        "temperatureCelsius", 86,
        "source", "seed-equipment-001@1");
    assertInvalidResponse(tool, transport, "missing status");
    transport.response = Map.of(
        "equipmentId", "PUMP-001",
        "status", "warning",
        "temperatureCelsius", 86,
        "source", 7);
    assertInvalidResponse(tool, transport, "non-string source");
    transport.response = "PUMP-001";
    assertInvalidResponse(tool, transport, "non-map response");
    transport.response = null;
    assertInvalidResponse(tool, transport, "null response");

    RuntimeException boom = new RuntimeException("transport boom");
    transport.response = null;
    transport.failure = boom;
    try {
      tool.invoke(valid, kwargs);
      throw new AssertionError("transport exceptions must propagate");
    } catch (RuntimeException actual) {
      check(actual == boom, "transport exception must propagate unchanged, got " + actual);
    }

    Map<String, Object> mutableInputs = new LinkedHashMap<>();
    mutableInputs.put("equipmentId", "PUMP-001");
    Map<String, Object> mutableKwargs = new LinkedHashMap<>();
    mutableKwargs.put("traceId", "trace-2");
    transport.failure = null;
    transport.response = payload;
    tool.invoke(mutableInputs, mutableKwargs);
    Map<String, Object> recordedInputs = transport.calls.get(transport.calls.size() - 1);
    Map<String, Object> recordedKwargs = transport.callKwargs.get(transport.callKwargs.size() - 1);
    mutableInputs.put("equipmentId", "MUTATED");
    mutableKwargs.put("traceId", "MUTATED");
    check(recordedInputs.equals(Map.of("equipmentId", "PUMP-001")),
        "SDK must copy input maps before invokeInternal");
    check(recordedKwargs.equals(Map.of("traceId", "trace-2")),
        "SDK must copy kwargs maps before invokeInternal");

    System.out.println("PASS EquipmentToolTest");
  }

  private static void assertInvalid(EquipmentTool tool, RecordingTransport transport,
      Map<String, Object> inputs, String label) throws Exception {
    int before = transport.calls.size();
    try {
      tool.invoke(inputs, Map.of());
      throw new AssertionError("expected invalid input rejection: " + label);
    } catch (IllegalArgumentException expected) {
      check("TOOL_INPUT_CONTRACT_INVALID".equals(expected.getMessage()),
          label + " produced message " + expected.getMessage());
      check(transport.calls.size() == before,
          label + " must not call transport, calls grew to " + transport.calls.size());
    }
  }

  private static void assertInvalidResponse(EquipmentTool tool, RecordingTransport transport,
      String label) throws Exception {
    int before = transport.calls.size();
    try {
      tool.invoke(Map.of("equipmentId", "PUMP-001"), Map.of());
      throw new AssertionError("expected invalid response rejection: " + label);
    } catch (IllegalStateException expected) {
      check("TOOL_RESPONSE_CONTRACT_INVALID".equals(expected.getMessage()),
          label + " produced message " + expected.getMessage());
      check(transport.calls.size() == before + 1,
          label + " should perform exactly one transport call per invocation");
    }
  }

  private static void check(boolean condition, String message) {
    if (!condition) {
      throw new AssertionError(message);
    }
  }
}
