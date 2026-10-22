package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.LinkedHashMap;
import java.util.Map;

public final class EquipmentToolTest {

  private static final String INPUT_ERROR = "TOOL_INPUT_CONTRACT_INVALID";
  private static final String RESPONSE_ERROR = "TOOL_RESPONSE_CONTRACT_INVALID";
  private static int checks = 0;

  private static final class RecordingTransport extends Tool {
    int calls;
    Map<String, Object> lastInputs;
    Map<String, Object> lastKwargs;
    Object response;
    RuntimeException failure;

    RecordingTransport(ToolCard card) {
      super(card);
    }

    @Override
    protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs) {
      calls++;
      lastInputs = inputs;
      lastKwargs = kwargs;
      if (failure != null) {
        throw failure;
      }
      return response;
    }
  }

  public static void main(String[] args) throws Exception {
    String inputSchema = "{\"type\":\"object\",\"properties\":{\"equipmentId\":{\"type\":\"string\"}},\"required\":[\"equipmentId\"]}";
    ToolCard card = new ToolCard("get_equipment", "Query equipment status and temperature", inputSchema);

    // ---- 1. Valid invocation. Left uncaught on purpose: the stub must exit nonzero. ----
    RecordingTransport transport = new RecordingTransport(card);
    Map<String, Object> response = new LinkedHashMap<String, Object>();
    response.put("equipmentId", "PUMP-001");
    response.put("status", "warning");
    response.put("temperatureCelsius", 86);
    response.put("source", "seed-equipment-001@1");
    transport.response = response;

    EquipmentTool tool = new EquipmentTool(transport);
    check(tool.getCard() == card, "constructor must retain the exact original ToolCard");

    Map<String, Object> inputs = new LinkedHashMap<String, Object>();
    inputs.put("equipmentId", "PUMP-001");
    Map<String, Object> kwargs = new LinkedHashMap<String, Object>();
    kwargs.put("traceId", "trace-1");
    kwargs.put("actorId", "trusted-actor");
    kwargs.put("endpoint", "http://internal.example");

    Object out = tool.invoke(inputs, kwargs);
    check(transport.calls == 1, "valid invocation must call the transport exactly once");
    check(transport.lastInputs.equals(inputs), "transport must receive the input values (Map.equals)");
    check(transport.lastKwargs.equals(kwargs), "trusted kwargs must be propagated unchanged (Map.equals)");
    check(out instanceof Map, "valid response must be returned as a Map");
    check(((Map<?, ?>) out).equals(response), "output must equal the four-field transport response");

    // ---- 2. Input contract: only equipmentId:string, nonblank. Zero transport calls. ----
    expectInputRejected(card, mapOf("equipmentId", "PUMP-001", "actorId", "actor-1"));
    expectInputRejected(card, mapOf("equipmentId", "PUMP-001", "endpoint", "http://evil.example"));
    expectInputRejected(card, mapOf("equipmentId", "   "));
    expectInputRejected(card, mapOf("equipmentId", ""));
    expectInputRejected(card, mapOf("equipmentId", Integer.valueOf(123)));
    expectInputRejected(card, mapOf("other", "PUMP-001"));
    expectInputRejected(card, new LinkedHashMap<String, Object>());
    expectInputRejectedOnNullMaps(card);

    // ---- 3. Response contract: exact four fields, no coercion, no retry. ----
    expectResponseRejected(card, mapOf("status", "warning", "temperatureCelsius", 86, "source", "s"), "missing equipmentId");
    expectResponseRejected(card, mapOf("equipmentId", "PUMP-001", "temperatureCelsius", 86, "source", "s"), "missing status");
    expectResponseRejected(card, mapOf("equipmentId", "PUMP-001", "status", "warning", "source", "s"), "missing temperature");
    expectResponseRejected(card, mapOf("equipmentId", "PUMP-001", "status", "warning", "temperatureCelsius", 86), "missing source");
    expectResponseRejected(card, mapOf("equipmentId", "PUMP-001", "status", "warning", "temperatureCelsius", "86", "source", "s"), "string temperature");
    expectResponseRejected(card, mapOf("equipmentId", "PUMP-001", "status", 1, "temperatureCelsius", 86, "source", "s"), "numeric status");
    expectResponseRejected(card, mapOf("equipmentId", 1, "status", "warning", "temperatureCelsius", 86, "source", "s"), "numeric equipmentId");
    expectResponseRejected(card, mapOf("equipmentId", "PUMP-001", "status", "warning", "temperatureCelsius", 86, "source", 7), "numeric source");
    expectResponseRejected(card, "not-a-map", "non-map response");
    expectResponseRejected(card, null, "null response");

    // Long, zero and negative temperatures must be preserved exactly.
    long zero = 0L;
    Map<String, Object> zeroResponse = mapOf("equipmentId", "PUMP-002", "status", "normal", "temperatureCelsius", Long.valueOf(zero), "source", "seed-equipment-002@1");
    RecordingTransport zeroTransport = transportWith(card, zeroResponse);
    Object zeroOut = new EquipmentTool(zeroTransport).invoke(mapOf("equipmentId", "PUMP-002"), new LinkedHashMap<String, Object>());
    check(zeroTransport.calls == 1, "zero-temperature response must be a single transport call");
    check(zeroOut instanceof Map && ((Map<?, ?>) zeroOut).equals(zeroResponse), "Long zero temperature must be preserved");

    Map<String, Object> negativeResponse = mapOf("equipmentId", "PUMP-003", "status", "fault", "temperatureCelsius", Integer.valueOf(-12), "source", "seed-equipment-003@1");
    RecordingTransport negativeTransport = transportWith(card, negativeResponse);
    Object negativeOut = new EquipmentTool(negativeTransport).invoke(mapOf("equipmentId", "PUMP-003"), new LinkedHashMap<String, Object>());
    check(negativeOut instanceof Map && ((Map<?, ?>) negativeOut).equals(negativeResponse), "negative temperature must be preserved");

    // Extra response fields must not leak into the output.
    Map<String, Object> extraResponse = mapOf("equipmentId", "PUMP-001", "status", "warning", "temperatureCelsius", 86, "source", "s", "debug", "leak", "endpoint", "http://evil.example");
    RecordingTransport extraTransport = transportWith(card, extraResponse);
    Object extraOut = new EquipmentTool(extraTransport).invoke(mapOf("equipmentId", "PUMP-001"), new LinkedHashMap<String, Object>());
    Map<String, Object> expectedFour = mapOf("equipmentId", "PUMP-001", "status", "warning", "temperatureCelsius", 86, "source", "s");
    check(expectedFour.equals(extraOut), "output must contain only the four contract fields");
    check(!(extraOut instanceof Map && ((Map<?, ?>) extraOut).containsKey("debug")), "extra response fields must not leak");

    // ---- 4. Transport exceptions propagate unchanged, no retry. ----
    RecordingTransport failing = new RecordingTransport(card);
    RuntimeException marker = new IllegalStateException("read-timeout-marker");
    failing.failure = marker;
    try {
      new EquipmentTool(failing).invoke(mapOf("equipmentId", "PUMP-001"), new LinkedHashMap<String, Object>());
      throw new AssertionError("transport failure must propagate");
    } catch (RuntimeException e) {
      check(e == marker, "transport exception object must propagate unchanged by identity");
    }
    check(failing.calls == 1, "failing transport must be called exactly once (no retry)");

    System.out.println("EquipmentToolTest OK: " + checks + " checks passed");
  }

  private static RecordingTransport transportWith(ToolCard card, Object response) {
    RecordingTransport transport = new RecordingTransport(card);
    transport.response = response;
    return transport;
  }

  private static void expectInputRejected(ToolCard card, Map<String, Object> badInputs) throws Exception {
    RecordingTransport transport = new RecordingTransport(card);
    transport.response = mapOf("equipmentId", "PUMP-001", "status", "warning", "temperatureCelsius", 86, "source", "s");
    EquipmentTool tool = new EquipmentTool(transport);
    try {
      tool.invoke(badInputs, null);
    } catch (IllegalArgumentException e) {
      check(INPUT_ERROR.equals(e.getMessage()), "input rejection message must be " + INPUT_ERROR);
      check(transport.calls == 0, "invalid inputs must not reach the transport: " + badInputs);
      return;
    }
    throw new AssertionError("expected IllegalArgumentException " + INPUT_ERROR + " for inputs " + badInputs);
  }

  private static void expectInputRejectedOnNullMaps(ToolCard card) throws Exception {
    RecordingTransport transport = new RecordingTransport(card);
    transport.response = mapOf("equipmentId", "PUMP-001", "status", "warning", "temperatureCelsius", 86, "source", "s");
    EquipmentTool tool = new EquipmentTool(transport);
    try {
      tool.invoke(null, null);
    } catch (IllegalArgumentException e) {
      check(INPUT_ERROR.equals(e.getMessage()), "null maps must be rejected with " + INPUT_ERROR);
      check(transport.calls == 0, "null maps must not reach the transport");
      return;
    }
    throw new AssertionError("expected IllegalArgumentException " + INPUT_ERROR + " for null maps");
  }

  private static void expectResponseRejected(ToolCard card, Object badResponse, String label) throws Exception {
    RecordingTransport transport = transportWith(card, badResponse);
    EquipmentTool tool = new EquipmentTool(transport);
    try {
      tool.invoke(mapOf("equipmentId", "PUMP-001"), new LinkedHashMap<String, Object>());
    } catch (IllegalStateException e) {
      check(RESPONSE_ERROR.equals(e.getMessage()), "response rejection message must be " + RESPONSE_ERROR + " for " + label);
      check(transport.calls == 1, "invalid response must not trigger a retry for " + label);
      return;
    }
    throw new AssertionError("expected IllegalStateException " + RESPONSE_ERROR + " for " + label);
  }

  private static Map<String, Object> mapOf(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<String, Object>();
    for (int i = 0; i < pairs.length; i += 2) {
      map.put((String) pairs[i], pairs[i + 1]);
    }
    return map;
  }

  private static void check(boolean condition, String message) {
    checks++;
    if (!condition) {
      throw new AssertionError(message);
    }
  }
}
