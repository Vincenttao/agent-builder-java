package local.agentbuilder.bridge;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import com.openjiuwen.core.session.AgentSessionApi;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.function.Consumer;

/** Supported v1 contract: required flat scalar fields. Endpoint and token are never model arguments. */
public final class RegisteredHttpTool extends Tool {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final URI endpoint;
    private final String token;
    private final Map<String, String> inputFields;
    private final Map<String, String> responseFields;
    private final Duration timeout;
    private final HttpClient client;
    private final boolean readErrorResults;
    private final String connectionRef;
    private final String toolVersion;
    private final Consumer<Map<String,Object>> events;
    public record ReadFailure(String kind, String code, String message) {}

    public RegisteredHttpTool(String name, String description, URI endpoint, String token,
                              Map<String, String> inputFields, Map<String, String> responseFields, Duration timeout) {
        this(name, description, endpoint, token, inputFields, responseFields, timeout, false, "local-test-http@1", "local-test-tool@1", event -> {});
    }
    public RegisteredHttpTool(String name, String description, URI endpoint, String token,
                              Map<String, String> inputFields, Map<String, String> responseFields, Duration timeout, boolean readErrorResults) {
        this(name, description, endpoint, token, inputFields, responseFields, timeout, readErrorResults, "local-test-http@1", "local-test-tool@1", event -> {});
    }
    public RegisteredHttpTool(String name, String description, URI endpoint, String token,
                              Map<String, String> inputFields, Map<String, String> responseFields, Duration timeout, boolean readErrorResults,
                              String connectionRef, String toolVersion, Consumer<Map<String,Object>> events) {
        super(new ToolCard(name + "-v1", name, description, schema(inputFields)));
        if (!List.of("http", "https").contains(endpoint.getScheme()) || endpoint.getUserInfo() != null || endpoint.getFragment() != null)
            throw new IllegalArgumentException("INVALID_TOOL_ENDPOINT");
        this.endpoint = endpoint; this.token = token; this.inputFields = Map.copyOf(inputFields);
        this.responseFields = Map.copyOf(responseFields); this.timeout = timeout;
        this.client = HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build();
        this.readErrorResults = readErrorResults;
        this.connectionRef = connectionRef; this.toolVersion = toolVersion; this.events = events;
        for (String type : responseFields.values()) validateType(type);
    }

    @Override protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs) throws Exception {
        if (!valid(inputs, inputFields, true)) throw new IllegalArgumentException("TOOL_INPUT_CONTRACT_INVALID");
        long started = System.nanoTime();
        String sessionId = kwargs != null && kwargs.get("session") instanceof AgentSessionApi session ? session.getSessionId() : "";
        try {
            Object result = request(inputs, kwargs);
            events.accept(Map.ofEntries(Map.entry("event", "tool_call"), Map.entry("tool", getCard().getName()), Map.entry("protocol", "http"),
                    Map.entry("connectionRef", connectionRef), Map.entry("toolVersion", toolVersion), Map.entry("parameterDigest", digest(inputs)),
                    Map.entry("resultDigest", digest(result)), Map.entry("durationMs", Math.max(0L,(System.nanoTime()-started)/1_000_000L)),
                    Map.entry("status", "succeeded"), Map.entry("sessionId", sessionId)));
            return result;
        }
        catch (IllegalStateException error) {
            if (error.getMessage() != null && error.getMessage().startsWith("TOOL_")) events.accept(Map.ofEntries(
                    Map.entry("event", "tool_call"), Map.entry("tool", getCard().getName()), Map.entry("protocol", "http"),
                    Map.entry("connectionRef", connectionRef), Map.entry("toolVersion", toolVersion), Map.entry("parameterDigest", digest(inputs)),
                    Map.entry("durationMs", Math.max(0L,(System.nanoTime()-started)/1_000_000L)), Map.entry("status", "failed"),
                    Map.entry("errorCode", error.getMessage()), Map.entry("sessionId", sessionId)));
            if (!readErrorResults) throw error;
            return readFailure(error);
        }
    }
    private static String digest(Object value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(JSON.writeValueAsBytes(value)));
    }
    static ReadFailure readFailure(IllegalStateException error) {
        String code = error.getMessage();
        if (code == null || !(List.of("TOOL_TIMEOUT", "TOOL_TRANSPORT_ERROR", "TOOL_RESPONSE_CONTRACT_INVALID").contains(code) || code.matches("TOOL_HTTP_STATUS:[45]\\d\\d"))) throw error;
        return new ReadFailure("tool-error", code.equals("TOOL_TIMEOUT") ? "TOOL_TIMEOUT" : "TOOL_UNAVAILABLE", "工具未返回有效结果，业务事实未知");
    }
    private Object request(Map<String, Object> inputs, Map<String, Object> kwargs) throws Exception {
        if (!valid(inputs, inputFields, true)) throw new IllegalArgumentException("TOOL_INPUT_CONTRACT_INVALID");
        HttpRequest.Builder builder = HttpRequest.newBuilder(endpoint).timeout(timeout)
                .header("Authorization", "Bearer " + token).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(inputs)));
        // Correlation comes from the runtime session, never from model-supplied tool arguments.
        if (kwargs != null && kwargs.get("session") instanceof AgentSessionApi session) {
            builder.header("X-Builder-Session-Id", session.getSessionId());
            if (session.getState("builderToolCallId") instanceof String callId) builder.header("X-Builder-Tool-Call-Id", callId);
        }
        HttpRequest request = builder.build();
        HttpResponse<String> response;
        try { response = client.send(request, HttpResponse.BodyHandlers.ofString()); }
        catch (HttpTimeoutException error) { throw new IllegalStateException("TOOL_TIMEOUT"); }
        catch (java.io.IOException error) { throw new IllegalStateException("TOOL_TRANSPORT_ERROR"); }
        if (response.statusCode() < 200 || response.statusCode() >= 300)
            throw new IllegalStateException("TOOL_HTTP_STATUS:" + response.statusCode());
        Map<String, Object> body;
        try { body = JSON.readValue(response.body(), new TypeReference<Map<String, Object>>() {}); }
        catch (Exception error) { throw new IllegalStateException("TOOL_RESPONSE_CONTRACT_INVALID"); }
        if (!valid(body, responseFields, false)) throw new IllegalStateException("TOOL_RESPONSE_CONTRACT_INVALID");
        return body;
    }

    private static Map<String, Object> schema(Map<String, String> fields) {
        Map<String, Object> properties = new LinkedHashMap<>();
        fields.forEach((name, type) -> { validateType(type); properties.put(name, Map.of("type", type)); });
        return Map.of("type", "object", "properties", properties, "required", List.copyOf(fields.keySet()), "additionalProperties", false);
    }
    private static void validateType(String type) {
        if (!List.of("string", "integer", "boolean", "array").contains(type)) throw new IllegalArgumentException("UNSUPPORTED_CONTRACT_TYPE");
    }
    private static boolean valid(Map<String, Object> data, Map<String, String> fields, boolean exact) {
        if (data == null || exact && !data.keySet().equals(fields.keySet())) return false;
        for (var field : fields.entrySet()) {
            Object value = data.get(field.getKey());
            boolean matches = switch (field.getValue()) {
                case "string" -> value instanceof String;
                case "integer" -> value instanceof Integer || value instanceof Long;
                case "boolean" -> value instanceof Boolean;
                case "array" -> value instanceof List<?>;
                default -> false;
            };
            if (!matches) return false;
        }
        return true;
    }
}
