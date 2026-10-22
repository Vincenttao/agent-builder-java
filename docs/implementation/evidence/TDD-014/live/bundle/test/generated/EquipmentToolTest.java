package generated;

import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import java.util.*;

public final class EquipmentToolTest {
    private static ToolCard card;
    private static RecordingTool transport;
    private static EquipmentTool tool;

    public static void main(String[] args) throws Exception {
        card = makeCard();
        reset(validResponse());

        Map<String, Object> firstInputs = data("equipmentId", "PUMP-001");
        Map<String, Object> firstKwargs = data("actorId", "svc-actor", "requestId", "req-1");

        // RED ANCHOR: uncaught valid invocation. The stub must exit nonzero here.
        Object firstResult = tool.invoke(firstInputs, firstKwargs);

        check(tool.getCard() == transport.getCard(), "constructor must retain transport.getCard() by identity");
        check(transport.calls == 1, "valid invocation must call transport exactly once");
        check(transport.seenInputs.equals(firstInputs), "transport inputs must equal original values (Map.equals)");
        check(transport.seenKwargs.equals(firstKwargs), "trusted runtime kwargs must be preserved (Map.equals)");

        check(firstResult instanceof Map, "valid transport response must produce a Map result");
        Map<String, Object> projected = asMap(firstResult);
        check(projected.size() == 4, "result must contain exactly the four contract fields");
        eq("PUMP-001", projected.get("equipmentId"), "equipmentId projection");
        eq("warning", projected.get("status"), "status projection");
        eq(Integer.valueOf(86), projected.get("temperatureCelsius"), "temperature projection");
        eq("seed-equipment-001@1", projected.get("source"), "source projection");
        check(!projected.containsKey("internalToken"), "extra transport fields must not be exposed");
        check(projected.get("temperatureCelsius") instanceof Integer, "Integer temperature must keep its type");
        check(transport.response instanceof Map, "test transport response sanity");
        eq(Integer.valueOf(5), Integer.valueOf(((Map<?, ?>) transport.response).size()),
                "tool must not mutate the original transport response");

        // Negative and zero temperatures are preserved numerically.
        reset(data("equipmentId", "PUMP-002", "status", "warning",
                "temperatureCelsius", Integer.valueOf(-12), "source", "sensor-2"));
        Map<String, Object> negative = asMap(tool.invoke(data("equipmentId", "PUMP-002"), data()));
        eq(Integer.valueOf(-12), negative.get("temperatureCelsius"), "negative temperature preserved");
        check(negative.get("temperatureCelsius") instanceof Integer, "negative Integer stays Integer");

        reset(data("equipmentId", "PUMP-003", "status", "ok",
                "temperatureCelsius", Integer.valueOf(0), "source", "sensor-3"));
        Map<String, Object> zero = asMap(tool.invoke(data("equipmentId", "PUMP-003"), data()));
        eq(Integer.valueOf(0), zero.get("temperatureCelsius"), "zero temperature preserved");

        // Long temperatures are valid and must not be coerced.
        reset(data("equipmentId", "PUMP-004", "status", "ok",
                "temperatureCelsius", Long.valueOf(87L), "source", "sensor-4"));
        Map<String, Object> longTemp = asMap(tool.invoke(data("equipmentId", "PUMP-004"), data()));
        eq(Long.valueOf(87L), longTemp.get("temperatureCelsius"), "Long temperature preserved");
        check(longTemp.get("temperatureCelsius") instanceof Long, "Long temperature stays Long");

        // Runtime kwargs are trusted transport data, not model input fields.
        reset(validResponse());
        Map<String, Object> trustedKwargs = data("actorId", "svc-actor", "endpoint", "internal://equipment",
                "requestId", "req-9", "timeoutMillis", Long.valueOf(1500L));
        tool.invoke(data("equipmentId", "PUMP-001"), trustedKwargs);
        check(transport.seenKwargs.equals(trustedKwargs), "kwargs like actorId/endpoint must be preserved for transport");
        check(transport.calls == 1, "kwargs invocation must call transport once");

        // Invalid responses: fail closed with the response contract error, no retry.
        List<Object> badResponses = new ArrayList<Object>();
        badResponses.add(null);
        badResponses.add("not-a-map");
        badResponses.add(data("equipmentId", "PUMP-001", "temperatureCelsius", Integer.valueOf(86),
                "source", "seed-equipment-001@1")); // missing status
        badResponses.add(data("equipmentId", "PUMP-001", "status", "warning",
                "temperatureCelsius", "86", "source", "seed-equipment-001@1")); // string number
        badResponses.add(data("equipmentId", "PUMP-001", "status", "warning",
                "temperatureCelsius", Double.valueOf(86.0), "source", "seed-equipment-001@1")); // wrong numeric type
        badResponses.add(data("equipmentId", Integer.valueOf(7), "status", "warning",
                "temperatureCelsius", Integer.valueOf(86), "source", "seed-equipment-001@1")); // wrong id type
        badResponses.add(data("equipmentId", "PUMP-001", "status", "warning",
                "temperatureCelsius", Integer.valueOf(86))); // missing source
        badResponses.add(data("equipmentId", "PUMP-001", "status", Integer.valueOf(1),
                "temperatureCelsius", Integer.valueOf(86), "source", "seed-equipment-001@1")); // wrong status type

        for (int i = 0; i < badResponses.size(); i++) {
            reset(badResponses.get(i));
            final int index = i;
            expectISE(new Call() {
                public Object run() throws Exception {
                    return tool.invoke(data("equipmentId", "PUMP-001"), data());
                }
            }, "bad response #" + index);
            check(transport.calls == 1, "bad response #" + index + " must not be retried");
        }

        // Invalid inputs: zero transport calls and the exact contract error.
        reset(validResponse());
        expectIAE(new Call() {
            public Object run() throws Exception {
                return tool.invoke(data(), data());
            }
        }, "missing equipmentId");
        check(transport.calls == 0, "missing equipmentId must not call transport");

        reset(validResponse());
        expectIAE(new Call() {
            public Object run() throws Exception {
                return tool.invoke(data("equipmentId", ""), data());
            }
        }, "empty equipmentId");
        check(transport.calls == 0, "empty equipmentId must not call transport");

        reset(validResponse());
        expectIAE(new Call() {
            public Object run() throws Exception {
                return tool.invoke(data("equipmentId", "   "), data());
            }
        }, "blank equipmentId");
        check(transport.calls == 0, "blank equipmentId must not call transport");

        reset(validResponse());
        expectIAE(new Call() {
            public Object run() throws Exception {
                return tool.invoke(data("equipmentId", Integer.valueOf(123)), data());
            }
        }, "non-string equipmentId");
        check(transport.calls == 0, "non-string equipmentId must not call transport");

        reset(validResponse());
        expectIAE(new Call() {
            public Object run() throws Exception {
                return tool.invoke(data("equipmentId", "PUMP-001", "actorId", "mallory"), data());
            }
        }, "extra input actorId");
        check(transport.calls == 0, "extra actorId input must not call transport");

        reset(validResponse());
        expectIAE(new Call() {
            public Object run() throws Exception {
                return tool.invoke(data("equipmentId", "PUMP-001", "endpoint", "http://evil"), data());
            }
        }, "extra input endpoint");
        check(transport.calls == 0, "extra endpoint input must not call transport");

        reset(validResponse());
        expectIAE(new Call() {
            public Object run() throws Exception {
                return tool.invoke(data("equipmentId", "PUMP-001", "status", "warning"), data());
            }
        }, "extra input status");
        check(transport.calls == 0, "extra status input must not call transport");

        reset(validResponse());
        final Map<String, Object> nullMap = null;
        expectIAE(new Call() {
            public Object run() throws Exception {
                return tool.invoke(nullMap, nullMap);
            }
        }, "null input and kwargs maps");
        check(transport.calls == 0, "null maps must be normalized to empty and rejected before transport");

        // Transport exceptions propagate unchanged (same instance).
        reset(validResponse());
        final RuntimeException boom = new RuntimeException("TRANSPORT_BOOM");
        transport.failure = boom;
        boolean thrown = false;
        try {
            tool.invoke(data("equipmentId", "PUMP-001"), data());
        } catch (Throwable t) {
            thrown = true;
            check(t == boom, "transport exception must propagate unchanged by identity");
        }
        check(thrown, "transport exception must be thrown");
        check(transport.calls == 1, "failing transport called exactly once, no retry");

        // Original input map must not be mutated.
        reset(validResponse());
        Map<String, Object> originalInput = data("equipmentId", "PUMP-001");
        tool.invoke(originalInput, data());
        check(originalInput.size() == 1, "tool must not mutate caller input map");

        System.out.println("ALL TESTS PASSED");
    }

    private interface Call {
        Object run() throws Exception;
    }

    private static final class RecordingTool extends Tool {
        Object response;
        RuntimeException failure;
        int calls;
        Map<String, Object> seenInputs;
        Map<String, Object> seenKwargs;

        RecordingTool(ToolCard toolCard) {
            super(toolCard);
        }

        @Override
        protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs) throws Exception {
            calls++;
            seenInputs = inputs;
            seenKwargs = kwargs;
            if (failure != null) {
                throw failure;
            }
            return response;
        }
    }

    private static void reset(Object response) {
        transport = new RecordingTool(card);
        transport.response = response;
        tool = new EquipmentTool(transport);
    }

    private static Map<String, Object> validResponse() {
        Map<String, Object> m = data("equipmentId", "PUMP-001", "status", "warning",
                "temperatureCelsius", Integer.valueOf(86), "source", "seed-equipment-001@1");
        m.put("internalToken", "must-not-leak");
        return m;
    }

    private static Map<String, Object> data(Object... pairs) {
        Map<String, Object> m = new LinkedHashMap<String, Object>();
        for (int i = 0; i < pairs.length; i += 2) {
            m.put((String) pairs[i], pairs[i + 1]);
        }
        return m;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value) {
        return (Map<String, Object>) value;
    }

    private static void expectIAE(Call call, String label) {
        try {
            call.run();
        } catch (IllegalArgumentException e) {
            eq("TOOL_INPUT_CONTRACT_INVALID", e.getMessage(), label + " error message");
            return;
        } catch (Throwable t) {
            throw new AssertionError(label + ": expected IllegalArgumentException but got " + t, t);
        }
        throw new AssertionError(label + ": expected IllegalArgumentException but call succeeded");
    }

    private static void expectISE(Call call, String label) {
        try {
            call.run();
        } catch (IllegalStateException e) {
            eq("TOOL_RESPONSE_CONTRACT_INVALID", e.getMessage(), label + " error message");
            return;
        } catch (Throwable t) {
            throw new AssertionError(label + ": expected IllegalStateException but got " + t, t);
        }
        throw new AssertionError(label + ": expected IllegalStateException but call succeeded");
    }

    private static void check(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    private static void eq(Object expected, Object actual, String message) {
        if (!Objects.equals(expected, actual)) {
            throw new AssertionError(message + " expected=" + expected + " actual=" + actual);
        }
    }

    private static ToolCard makeCard() {
        try {
            java.lang.reflect.Constructor<?>[] constructors = ToolCard.class.getDeclaredConstructors();
            for (java.lang.reflect.Constructor<?> constructor : constructors) {
                try {
                    constructor.setAccessible(true);
                    Class<?>[] types = constructor.getParameterTypes();
                    Object[] values = new Object[types.length];
                    for (int i = 0; i < types.length; i++) {
                        values[i] = sample(types[i]);
                    }
                    Object instance = constructor.newInstance(values);
                    if (instance instanceof ToolCard) {
                        return (ToolCard) instance;
                    }
                } catch (Throwable ignored) {
                    // try the next constructor
                }
            }
        } catch (Throwable ignored) {
            // fall through to null card
        }
        return null;
    }

    private static Object sample(Class<?> type) {
        if (type == String.class) {
            return "equipment-query-transport";
        }
        if (type == int.class || type == Integer.class) {
            return Integer.valueOf(0);
        }
        if (type == long.class || type == Long.class) {
            return Long.valueOf(0L);
        }
        if (type == boolean.class || type == Boolean.class) {
            return Boolean.FALSE;
        }
        if (type == double.class || type == Double.class) {
            return Double.valueOf(0.0d);
        }
        if (type == float.class || type == Float.class) {
            return Float.valueOf(0.0f);
        }
        if (type == short.class || type == Short.class) {
            return Short.valueOf((short) 0);
        }
        if (type == byte.class || type == Byte.class) {
            return Byte.valueOf((byte) 0);
        }
        if (type == char.class || type == Character.class) {
            return Character.valueOf('a');
        }
        if (Map.class.isAssignableFrom(type)) {
            return new LinkedHashMap<Object, Object>();
        }
        if (List.class.isAssignableFrom(type)) {
            return new ArrayList<Object>();
        }
        if (Set.class.isAssignableFrom(type)) {
            return new LinkedHashSet<Object>();
        }
        if (type.isEnum()) {
            Object[] constants = type.getEnumConstants();
            return constants.length > 0 ? constants[0] : null;
        }
        return null;
    }
}
