package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Dependency-free contract test for generated.EquipmentTool. */
public final class EquipmentToolTest {

  private interface ThrowingRunnable {
    void run() throws Exception;
  }

  private static final String INPUT_ERROR = "TOOL_INPUT_CONTRACT_INVALID";
  private static final String RESPONSE_ERROR = "TOOL_RESPONSE_CONTRACT_INVALID";

  private static final class RecordingTransport extends Tool {
    int invokeCount;
    Map<String, Object> lastInputs;
    Map<String, Object> lastKwargs;
    Object nextResponse;
    Exception nextFailure;

    RecordingTransport(ToolCard card) {
      super(card);
    }

    @Override
    protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs) throws Exception {
      invokeCount++;
      lastInputs = inputs;
      lastKwargs = kwargs;
      if (nextFailure != null) {
        throw nextFailure;
      }
      return nextResponse;
    }
  }

  private static void check(boolean condition, String message) {
    if (!condition) {
      throw new AssertionError("ASSERTION_FAILED: " + message);
    }
  }

  private static void checkEquals(Object expected, Object actual, String message) {
    if (expected == null ? actual != null : !expected.equals(actual)) {
      throw new AssertionError("ASSERTION_FAILED: " + message + " expected=" + expected + " actual=" + actual);
    }
  }

  private static Map<String, Object> map(Object... pairs) {
    Map<String, Object> value = new LinkedHashMap<String, Object>();
    for (int i = 0; i < pairs.length; i += 2) {
      value.put((String) pairs[i], pairs[i + 1]);
    }
    return value;
  }

  private static Map<String, Object> validResponse() {
    return map(
        "equipmentId", "PUMP-001",
        "status", "warning",
        "temperatureCelsius", Integer.valueOf(86),
        "source", "seed-equipment-001@1");
  }

  private static RecordingTransport transport(Object response) {
    RecordingTransport recording = new RecordingTransport(new ToolCard());
    recording.nextResponse = response;
    return recording;
  }

  private static void expectInputRejected(Tool tool, RecordingTransport recording, Map<String, Object> inputs,
      String label) throws Exception {
    int before = recording.invokeCount;
    try {
      tool.invoke(inputs, map("actorId", "trusted-runtime", "endpoint", "trusted-endpoint"));
    } catch (IllegalArgumentException expected) {
      checkEquals(INPUT_ERROR, expected.getMessage(), label + " message");
      checkEquals(before, recording.invokeCount, label + " made zero transport calls");
      return;
    }
    throw new AssertionError("ASSERTION_FAILED: " + label + " did not throw IllegalArgumentException");
  }

  private static void expectResponseRejected(Object response, String label) throws Exception {
    RecordingTransport recording = transport(response);
    EquipmentTool tool = new EquipmentTool(recording);
    int before = recording.invokeCount;
    try {
      tool.invoke(map("equipmentId", "PUMP-001"), map("actorId", "trusted-runtime"));
    } catch (IllegalStateException expected) {
      checkEquals(RESPONSE_ERROR, expected.getMessage(), label + " message");
      checkEquals(before + 1, recording.invokeCount, label + " invoked transport exactly once without retry");
      return;
    }
    throw new AssertionError("ASSERTION_FAILED: " + label + " did not throw IllegalStateException");
  }

  public static void main(String[] args) throws Exception {
    ToolCard card = new ToolCard();
    RecordingTransport cardTransport = new RecordingTransport(card);
    EquipmentTool cardTool = new EquipmentTool(cardTransport);
    check(cardTool.getCard() == card, "constructor retains transport.getCard() identity");

    // Valid response, trusted runtime kwargs preservation and pass-through of the input map.
    Map<String, Object> response = validResponse();
    RecordingTransport recording = transport(response);
    EquipmentTool tool = new EquipmentTool(recording);
    Map<String, Object> inputs = map("equipmentId", "PUMP-001");
    Map<String, Object> kwargs = map("actorId", "trusted-runtime", "endpoint", "trusted-endpoint", "traceId", "t-1");
    Object result = tool.invoke(inputs, kwargs);
    checkEquals(1, recording.invokeCount, "valid call invokes transport exactly once");
    check(recording.lastInputs == inputs, "valid call forwards the original inputs map");
    check(recording.lastKwargs == kwargs, "valid call forwards the original trusted kwargs map");
    checkEquals("trusted-runtime", recording.lastKwargs.get("actorId"), "runtime actorId preserved");
    checkEquals("trusted-endpoint", recording.lastKwargs.get("endpoint"), "runtime endpoint preserved");
    checkEquals("PUMP-001", inputs.get("equipmentId"), "inputs not mutated");
    checkEquals(3, kwargs.size(), "kwargs not mutated");
    check(result instanceof Map, "result is a Map");
    Map<?, ?> report = (Map<?, ?>) result;
    checkEquals(4, report.size(), "result contains only the four contract fields");
    checkEquals("PUMP-001", report.get("equipmentId"), "equipmentId preserved");
    checkEquals("warning", report.get("status"), "status preserved");
    checkEquals(Integer.valueOf(86), report.get("temperatureCelsius"), "Integer temperature preserved");
    checkEquals("seed-equipment-001@1", report.get("source"), "source preserved");
    checkEquals(4, response.size(), "transport response map not mutated");

    // Extra transport fields are not exposed.
    Map<String, Object> noisy = validResponse();
    noisy.put("actorId", "leaked");
    noisy.put("debug", Boolean.TRUE);
    RecordingTransport noisyTransport = transport(noisy);
    Object noisyResult = new EquipmentTool(noisyTransport).invoke(map("equipmentId", "PUMP-001"), map());
    check(noisyResult instanceof Map, "noisy result is a Map");
    checkEquals(4, ((Map<?, ?>) noisyResult).size(), "extra response fields filtered out");
    check(!((Map<?, ?>) noisyResult).containsKey("actorId"), "actorId not exposed from response");
    checkEquals(6, noisy.size(), "noisy response not mutated");

    // Zero and negative temperatures must be preserved exactly (no truthiness or absolute coercion).
    for (Object temperature : new Object[] {Integer.valueOf(0), Integer.valueOf(-12),
        Integer.valueOf(Integer.MIN_VALUE), Long.valueOf(9000000000L), Long.valueOf(-1L)}) {
      Map<String, Object> temperatureResponse = validResponse();
      temperatureResponse.put("temperatureCelsius", temperature);
      Object temperatureResult = new EquipmentTool(transport(temperatureResponse))
          .invoke(map("equipmentId", "PUMP-001"), map());
      checkEquals(temperature, ((Map<?, ?>) temperatureResult).get("temperatureCelsius"),
          "temperature preserved for " + temperature);
    }

    // Invalid inputs: rejected before any transport call.
    expectInputRejected(tool, recording, null, "null inputs");
    expectInputRejected(tool, recording, map(), "empty inputs");
    expectInputRejected(tool, recording, map("status", "warning"), "missing equipmentId");
    expectInputRejected(tool, recording, map("equipmentId", ""), "blank equipmentId");
    expectInputRejected(tool, recording, map("equipmentId", "   "), "whitespace equipmentId");
    expectInputRejected(tool, recording, map("equipmentId", null), "null equipmentId");
    expectInputRejected(tool, recording, map("equipmentId", Integer.valueOf(1)), "non-string equipmentId");
    expectInputRejected(tool, recording,
        map("equipmentId", "PUMP-001", "actorId", "model-supplied"), "extra actorId input");
    expectInputRejected(tool, recording,
        map("equipmentId", "PUMP-001", "endpoint", "http://evil.invalid"), "extra endpoint input");
    expectInputRejected(tool, recording,
        map("equipmentId", "PUMP-001", "timeout", Integer.valueOf(1)), "extra timeout input");
    checkEquals(1, recording.invokeCount, "all invalid inputs together made zero transport calls");

    // Invalid responses: IllegalStateException, exactly one transport call, no invented facts.
    expectResponseRejected(null, "null response");
    expectResponseRejected("not-a-map", "string response");
    expectResponseRejected(new ArrayList<Object>(), "list response");
    expectResponseRejected(map("status", "warning", "temperatureCelsius", Integer.valueOf(86),
        "source", "seed-equipment-001@1"), "missing equipmentId");
    expectResponseRejected(map("equipmentId", "PUMP-001", "temperatureCelsius", Integer.valueOf(86),
        "source", "seed-equipment-001@1"), "missing status");
    expectResponseRejected(map("equipmentId", "PUMP-001", "status", "warning",
        "source", "seed-equipment-001@1"), "missing temperatureCelsius");
    expectResponseRejected(map("equipmentId", "PUMP-001", "status", "warning",
        "temperatureCelsius", Integer.valueOf(86)), "missing source");
    expectResponseRejected(map("equipmentId", Integer.valueOf(1), "status", "warning",
        "temperatureCelsius", Integer.valueOf(86), "source", "seed-equipment-001@1"),
        "non-string equipmentId");
    expectResponseRejected(map("equipmentId", "PUMP-001", "status", Integer.valueOf(1),
        "temperatureCelsius", Integer.valueOf(86), "source", "seed-equipment-001@1"),
        "non-string status");
    expectResponseRejected(map("equipmentId", "PUMP-001", "status", "warning",
        "temperatureCelsius", "86", "source", "seed-equipment-001@1"),
        "string temperature not coerced");
    expectResponseRejected(map("equipmentId", "PUMP-001", "status", "warning",
        "temperatureCelsius", Double.valueOf(86.5), "source", "seed-equipment-001@1"),
        "fractional temperature rejected");
    expectResponseRejected(map("equipmentId", "PUMP-001", "status", "warning",
        "temperatureCelsius", null, "source", "seed-equipment-001@1"),
        "null temperature rejected");
    expectResponseRejected(map("equipmentId", "PUMP-001", "status", "warning",
        "temperatureCelsius", Integer.valueOf(86), "source", Integer.valueOf(7)),
        "non-string source");

    // Transport failures propagate unchanged, with no retry and no fabricated report.
    RuntimeException runtimeFailure = new IllegalStateException("TRANSPORT_DOWN");
    RecordingTransport runtimeTransport = transport(validResponse());
    runtimeTransport.nextFailure = runtimeFailure;
    try {
      new EquipmentTool(runtimeTransport).invoke(map("equipmentId", "PUMP-001"), map());
      throw new AssertionError("ASSERTION_FAILED: runtime transport failure was swallowed");
    } catch (RuntimeException caught) {
      check(caught == runtimeFailure, "runtime transport exception propagated unchanged");
      checkEquals(1, runtimeTransport.invokeCount, "runtime failure not retried");
    }

    Exception checkedFailure = new Exception("READ_TIMEOUT");
    RecordingTransport checkedTransport = transport(validResponse());
    checkedTransport.nextFailure = checkedFailure;
    try {
      new EquipmentTool(checkedTransport).invoke(map("equipmentId", "PUMP-001"), map());
      throw new AssertionError("ASSERTION_FAILED: checked transport failure was swallowed");
    } catch (Exception caught) {
      check(caught == checkedFailure, "checked transport exception propagated unchanged");
      checkEquals(1, checkedTransport.invokeCount, "checked failure not retried");
    }

    System.out.println("EQUIPMENT_TOOL_TESTS_PASSED");
  }
}
