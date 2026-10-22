package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class EquipmentToolTest {

  public static void main(String[] args) throws Exception {
    ToolCard card = makeCard();
    RecordingTool transport = new RecordingTool(card);
    Map<String, Object> rawResponse = response(Integer.valueOf(-5));
    rawResponse.put("modelInjected", "must-not-leak");
    transport.response = rawResponse;

    EquipmentTool tool = new EquipmentTool(transport);
    check(tool.getCard() == transport.getCard(), "constructor must retain transport card");

    Map<String, Object> inputs = map("equipmentId", "PUMP-001");
    Map<String, Object> kwargs = map("runtimeKey", "runtimeValue", "traceId", "t-1");

    // This first invocation is deliberately uncaught so the stub exits nonzero.
    Object first = tool.invoke(inputs, kwargs);

    check(first instanceof Map, "valid result must be a Map");
    Map<String, Object> expected = map(
        "equipmentId", "PUMP-001",
        "status", "warning",
        "temperatureCelsius", Integer.valueOf(-5),
        "source", "seed-equipment-001@1");
    check(expected.equals(first), "valid result must contain exactly the four original fields");
    check(!((Map<?, ?>) first).containsKey("modelInjected"), "extra transport field must be dropped");
    check(Integer.valueOf(-5).equals(((Map<?, ?>) first).get("temperatureCelsius")),
        "negative integer temperature must be preserved");

    check(transport.calls == 1, "valid invocation must call transport once");
    check(inputs.equals(transport.lastInputs), "transport inputs must equal original values");
    check(kwargs.equals(transport.lastKwargs), "trusted runtime kwargs must be preserved");
    check(transport.lastInputs.size() == 1, "only equipmentId may be forwarded as input");

    // Zero and Long temperatures must be preserved with their original type.
    RecordingTool zeroTransport = new RecordingTool(card);
    zeroTransport.response = response(Long.valueOf(0L));
    EquipmentTool zeroTool = new EquipmentTool(zeroTransport);
    Object zeroResult = zeroTool.invoke(map("equipmentId", "PUMP-001"), map());
    check(zeroResult instanceof Map, "zero result must be a Map");
    Object zeroTemp = ((Map<?, ?>) zeroResult).get("temperatureCelsius");
    check(Long.valueOf(0L).equals(zeroTemp), "zero temperature must be preserved");
    check(zeroTemp instanceof Long, "zero Long temperature type must be preserved");
    check(zeroTransport.lastKwargs.isEmpty(), "empty kwargs must stay empty");

    // Input contract rejections must use IllegalArgumentException and zero transport calls.
    expectInvalidInput(new Call() {
      public Object run() throws Exception {
        return newTool(card, response(Integer.valueOf(20))).invoke(map(), map());
      }
    }, "missing equipmentId");
    expectInvalidInput(new Call() {
      public Object run() throws Exception {
        return newTool(card, response(Integer.valueOf(20))).invoke(map("equipmentId", ""), map());
      }
    }, "empty equipmentId");
    expectInvalidInput(new Call() {
      public Object run() throws Exception {
        return newTool(card, response(Integer.valueOf(20))).invoke(map("equipmentId", "   "), map());
      }
    }, "blank equipmentId");
    expectInvalidInput(new Call() {
      public Object run() throws Exception {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        m.put("equipmentId", null);
        return newTool(card, response(Integer.valueOf(20))).invoke(m, map());
      }
    }, "null equipmentId");
    expectInvalidInput(new Call() {
      public Object run() throws Exception {
        return newTool(card, response(Integer.valueOf(20))).invoke(map("equipmentId", Integer.valueOf(7)), map());
      }
    }, "non-string equipmentId");
    expectInvalidInput(new Call() {
      public Object run() throws Exception {
        Map<String, Object> m = map("equipmentId", "PUMP-001");
        m.put("actorId", "model-controlled");
        return newTool(card, response(Integer.valueOf(20))).invoke(m, map());
      }
    }, "extra actorId input");
    expectInvalidInput(new Call() {
      public Object run() throws Exception {
        Map<String, Object> m = map("equipmentId", "PUMP-001");
        m.put("endpoint", "http://model-controlled.invalid");
        return newTool(card, response(Integer.valueOf(20))).invoke(m, map());
      }
    }, "extra endpoint input");
    expectInvalidInput(new Call() {
      public Object run() throws Exception {
        Map<String, Object> m = map("equipmentId", "PUMP-001");
        m.put("unexpected", "x");
        return newTool(card, response(Integer.valueOf(20))).invoke(m, map());
      }
    }, "extra arbitrary input");
    expectInvalidInput(new Call() {
      public Object run() throws Exception {
        return newTool(card, response(Integer.valueOf(20)))
            .invoke((Map<String, Object>) null, (Map<String, Object>) null);
      }
    }, "null maps normalize to empty and fail validation");

    // Response contract rejections must use IllegalStateException and no invention.
    List<Object> badResponses = new ArrayList<Object>();
    badResponses.add(null);
    badResponses.add("not-a-map");
    badResponses.add(responseWithout("equipmentId"));
    badResponses.add(responseWithout("status"));
    badResponses.add(responseWithout("temperatureCelsius"));
    badResponses.add(responseWithout("source"));
    badResponses.add(responseWith("equipmentId", Integer.valueOf(1)));
    badResponses.add(responseWith("status", Integer.valueOf(1)));
    badResponses.add(responseWith("source", Boolean.TRUE));
    badResponses.add(responseWith("temperatureCelsius", "86"));
    badResponses.add(responseWith("temperatureCelsius", Double.valueOf(86.5)));
    badResponses.add(responseWith("temperatureCelsius", null));

    for (int i = 0; i < badResponses.size(); i++) {
      final Object bad = badResponses.get(i);
      expectInvalidResponse(new Call() {
        public Object run() throws Exception {
          RecordingTool t = new RecordingTool(card);
          t.response = bad;
          return new EquipmentTool(t).invoke(map("equipmentId", "PUMP-001"), map());
        }
      }, "invalid response index " + i);
    }

    // Transport exceptions must propagate unchanged, including identity.
    RecordingTool failing = new RecordingTool(card);
    RuntimeException boom = new IllegalStateException("transport-boom");
    failing.failure = boom;
    try {
      new EquipmentTool(failing).invoke(map("equipmentId", "PUMP-001"), map());
      throw new AssertionError("transport failure must propagate");
    } catch (Exception e) {
      check(e == boom, "transport exception object must propagate unchanged");
    }

    System.out.println("EQUIPMENT_TOOL_TEST_OK");
  }

  private static EquipmentTool newTool(ToolCard card, Object response) {
    RecordingTool t = new RecordingTool(card);
    t.response = response;
    return new EquipmentTool(t);
  }

  private static void expectInvalidInput(Call call, String label) throws Exception {
    try {
      call.run();
      throw new AssertionError(label + ": expected IllegalArgumentException");
    } catch (IllegalArgumentException e) {
      check("TOOL_INPUT_CONTRACT_INVALID".equals(e.getMessage()),
          label + ": wrong message " + e.getMessage());
    }
  }

  private static void expectInvalidResponse(Call call, String label) throws Exception {
    try {
      call.run();
      throw new AssertionError(label + ": expected IllegalStateException");
    } catch (IllegalStateException e) {
      check("TOOL_RESPONSE_CONTRACT_INVALID".equals(e.getMessage()),
          label + ": wrong message " + e.getMessage());
    }
  }

  private interface Call {
    Object run() throws Exception;
  }

  private static final class RecordingTool extends Tool {
    Object response;
    RuntimeException failure;
    Map<String, Object> lastInputs;
    Map<String, Object> lastKwargs;
    int calls;

    RecordingTool(ToolCard card) {
      super(card);
    }

    @Override
    protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs)
        throws Exception {
      calls++;
      lastInputs = inputs;
      lastKwargs = kwargs;
      if (failure != null) {
        throw failure;
      }
      return response;
    }
  }

  private static Map<String, Object> response(Object temperature) {
    return map(
        "equipmentId", "PUMP-001",
        "status", "warning",
        "temperatureCelsius", temperature,
        "source", "seed-equipment-001@1");
  }

  private static Map<String, Object> responseWithout(String key) {
    Map<String, Object> m = response(Integer.valueOf(20));
    m.remove(key);
    return m;
  }

  private static Map<String, Object> responseWith(String key, Object value) {
    Map<String, Object> m = response(Integer.valueOf(20));
    m.put(key, value);
    return m;
  }

  private static Map<String, Object> map(Object... pairs) {
    Map<String, Object> m = new LinkedHashMap<String, Object>();
    for (int i = 0; i < pairs.length; i += 2) {
      m.put((String) pairs[i], pairs[i + 1]);
    }
    return m;
  }

  private static void check(boolean condition, String message) {
    if (!condition) {
      throw new AssertionError(message);
    }
  }

  private static ToolCard makeCard() {
    try {
      java.lang.reflect.Constructor<?>[] ctors = ToolCard.class.getDeclaredConstructors();
      for (java.lang.reflect.Constructor<?> ctor : ctors) {
        Class<?>[] types = ctor.getParameterTypes();
        Object[] args = new Object[types.length];
        for (int i = 0; i < types.length; i++) {
          args[i] = sample(types[i]);
        }
        try {
          ctor.setAccessible(true);
          Object card = ctor.newInstance(args);
          if (card != null) {
            return (ToolCard) card;
          }
        } catch (Throwable ignored) {
          // Try the next constructor shape.
        }
      }
    } catch (Throwable ignored) {
      // Fall back to null; the pinned Tool constructor accepts the card value.
    }
    return null;
  }

  private static Object sample(Class<?> type) {
    if (type == String.class || type == CharSequence.class) {
      return "transport";
    }
    if (type == boolean.class || type == Boolean.class) {
      return Boolean.FALSE;
    }
    if (type == int.class || type == Integer.class) {
      return Integer.valueOf(0);
    }
    if (type == long.class || type == Long.class) {
      return Long.valueOf(0L);
    }
    if (type == double.class || type == Double.class) {
      return Double.valueOf(0.0d);
    }
    if (Map.class.isAssignableFrom(type)) {
      return new LinkedHashMap<String, Object>();
    }
    if (Set.class.isAssignableFrom(type)) {
      return new LinkedHashSet<Object>();
    }
    if (java.util.Queue.class.isAssignableFrom(type)) {
      return new LinkedList<Object>();
    }
    if (java.util.Collection.class.isAssignableFrom(type)) {
      return new ArrayList<Object>();
    }
    if (type.isEnum()) {
      return type.getEnumConstants()[0];
    }
    return null;
  }
}
