package local.agentbuilder.bridge;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import com.openjiuwen.core.session.AgentSessionApi;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.spec.McpSchema;
import java.net.URI;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

/** Calls one pre-registered tool on a remote MCP Streamable HTTP server. */
public final class RegisteredMcpTool extends Tool {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final URI endpoint;
    private final String token;
    private final String remoteName;
    private final Map<String, String> inputFields;
    private final Map<String, String> responseFields;
    private final Duration timeout;
    private final String connectionRef;
    private final String toolVersion;
    private final Consumer<Map<String,Object>> events;

    public RegisteredMcpTool(String name, String description, URI endpoint, String token, String remoteName,
                             Map<String, String> inputFields, Map<String, String> responseFields, Duration timeout) {
        this(name, description, endpoint, token, remoteName, "local-test-mcp@1", "local-test-tool@1", inputFields, responseFields, timeout, event -> {});
    }
    public RegisteredMcpTool(String name, String description, URI endpoint, String token, String remoteName,
                             String connectionRef, String toolVersion, Map<String, String> inputFields,
                             Map<String, String> responseFields, Duration timeout, Consumer<Map<String,Object>> events) {
        super(new ToolCard(name + "-v1", name, description, schema(inputFields)));
        if (!List.of("http", "https").contains(endpoint.getScheme()) || endpoint.getUserInfo() != null || endpoint.getFragment() != null)
            throw new IllegalArgumentException("INVALID_MCP_ENDPOINT");
        if (token == null || token.isBlank() || remoteName == null || !remoteName.matches("[a-zA-Z0-9_.-]{1,128}"))
            throw new IllegalArgumentException("INVALID_MCP_CONNECTION");
        this.endpoint = endpoint; this.token = token; this.remoteName = remoteName;
        this.inputFields = Map.copyOf(inputFields); this.responseFields = Map.copyOf(responseFields); this.timeout = timeout;
        this.connectionRef = connectionRef; this.toolVersion = toolVersion; this.events = events;
        for (String type : responseFields.values()) validateType(type);
    }

    @Override protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs) throws Exception {
        if (!valid(inputs, inputFields, true)) throw new IllegalArgumentException("TOOL_INPUT_CONTRACT_INVALID");
        long started = System.nanoTime();
        String sessionId = kwargs != null && kwargs.get("session") instanceof AgentSessionApi session ? session.getSessionId() : null;
        if (sessionId == null || !sessionId.matches("[a-fA-F0-9-]{36}")) throw new IllegalStateException("MCP_RUNTIME_CONTEXT_REQUIRED");
        // The SDK defaults to the absolute URI path `/mcp`, which discards any
        // reverse-proxy prefix. Preserve the pinned full path explicitly.
        var transport = HttpClientStreamableHttpTransport.builder(endpoint.toString()).endpoint(endpoint.getRawPath())
                .supportedProtocolVersions(List.of("2025-06-18", "2025-03-26")).connectTimeout(timeout)
                .httpRequestCustomizer((request, method, uri, body, context) -> request.header("Authorization", "Bearer " + token)
                        .header("X-Builder-Session-Id", sessionId).timeout(timeout)).build();
        try (McpSyncClient client = McpClient.sync(transport).requestTimeout(timeout).initializationTimeout(timeout).build()) {
            var listed = client.listTools();
            McpSchema.Implementation server = client.getCurrentInitializationResult() == null ? null : client.getCurrentInitializationResult().serverInfo();
            McpSchema.Tool registered = listed.tools().stream().filter(tool -> remoteName.equals(tool.name())).findFirst()
                    .orElseThrow(() -> new IllegalStateException("MCP_TOOL_NOT_FOUND"));
            if (registered.meta() == null || !toolVersion.equals(registered.meta().get("version")))
                throw new IllegalStateException("MCP_TOOL_VERSION_MISMATCH");
            if (registered.inputSchema() == null || !validSchemaShape(registered.inputSchema(), inputFields))
                throw new IllegalStateException("MCP_TOOL_SCHEMA_MISMATCH");
            McpSchema.CallToolResult result = client.callTool(new McpSchema.CallToolRequest(remoteName, inputs));
            if (Boolean.TRUE.equals(result.isError())) throw new IllegalStateException("MCP_TOOL_CALL_FAILED");
            Map<String, Object> value = asObject(result.structuredContent());
            if (value == null) {
                String text = result.content().stream().filter(McpSchema.TextContent.class::isInstance)
                        .map(McpSchema.TextContent.class::cast).map(McpSchema.TextContent::text).findFirst().orElse(null);
                if (text != null) try { value = JSON.readValue(text, new TypeReference<>() {}); } catch (Exception ignored) { }
            }
            if (!valid(value, responseFields, false)) throw new IllegalStateException("MCP_RESPONSE_CONTRACT_INVALID");
            events.accept(Map.ofEntries(Map.entry("event", "mcp_tool_call"), Map.entry("tool", getCard().getName()), Map.entry("protocol", "mcp"),
                    Map.entry("connectionRef", connectionRef), Map.entry("toolVersion", toolVersion),
                    Map.entry("serverName", server == null || server.name() == null ? "unknown" : server.name()),
                    Map.entry("serverVersion", server == null || server.version() == null ? "unknown" : server.version()),
                    Map.entry("parameterDigest", digest(inputs)), Map.entry("resultDigest", digest(value)),
                    Map.entry("durationMs", Math.max(0L, (System.nanoTime() - started) / 1_000_000L)), Map.entry("status", "succeeded"), Map.entry("sessionId", sessionId)));
            return value;
        } catch (IllegalStateException error) {
            events.accept(Map.of("event", "mcp_tool_call", "tool", getCard().getName(), "protocol", "mcp",
                    "connectionRef", connectionRef, "toolVersion", toolVersion, "endpointPath", endpoint.getPath(),
                    "status", "failed", "errorCode", error.getMessage(), "sessionId", sessionId,
                    "durationMs", Math.max(0L, (System.nanoTime() - started) / 1_000_000L)));
            throw error;
        }
        catch (Exception error) {
            if (causeMatches(error, cause -> cause.getClass().getSimpleName().contains("Authorization"))) {
                events.accept(failureEvent(sessionId, started, "MCP_AUTHENTICATION_FAILED"));
                throw new IllegalStateException("MCP_AUTHENTICATION_FAILED");
            }
            if (causeMatches(error, cause -> cause.getClass().getSimpleName().contains("ProtocolVersion")
                    || cause.getMessage() != null && (cause.getMessage().toLowerCase().contains("protocol") || cause.getMessage().contains("400")))) {
                events.accept(failureEvent(sessionId, started, "MCP_PROTOCOL_UNSUPPORTED"));
                throw new IllegalStateException("MCP_PROTOCOL_UNSUPPORTED");
            }
            events.accept(failureEvent(sessionId, started, "MCP_TRANSPORT_FAILED"));
            throw new IllegalStateException("MCP_TRANSPORT_FAILED", error);
        }
    }

    private Map<String,Object> failureEvent(String sessionId, long started, String errorCode) {
        return Map.of("event", "mcp_tool_call", "tool", getCard().getName(), "protocol", "mcp", "connectionRef", connectionRef,
                "toolVersion", toolVersion, "endpointPath", endpoint.getPath(), "status", "failed", "errorCode", errorCode,
                "sessionId", sessionId, "durationMs", Math.max(0L, (System.nanoTime() - started) / 1_000_000L));
    }

    private static boolean causeMatches(Throwable error, java.util.function.Predicate<Throwable> match) {
        for (Throwable current = error; current != null; current = current.getCause()) if (match.test(current)) return true;
        return false;
    }

    private static String digest(Object value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(JSON.writeValueAsBytes(value)));
    }

    private static Map<String,Object> asObject(Object value) {
        if (value instanceof Map<?,?> map) {
            Map<String,Object> result = new LinkedHashMap<>();
            map.forEach((key,item) -> { if (key instanceof String name) result.put(name,item); });
            return result;
        }
        return null;
    }
    private static boolean validSchemaShape(McpSchema.JsonSchema schema, Map<String,String> fields) {
        Map<String,Object> properties = schema.properties();
        if (properties == null || !properties.keySet().equals(fields.keySet())) return false;
        if (schema.required() == null || !Set.copyOf(schema.required()).equals(fields.keySet()) || !Boolean.FALSE.equals(schema.additionalProperties())) return false;
        for (var field : fields.entrySet()) {
            Object fieldSchema = properties.get(field.getKey());
            if (!(fieldSchema instanceof Map<?,?> shape) || !field.getValue().equals(shape.get("type"))) return false;
        }
        return true;
    }
    private static Map<String,Object> schema(Map<String,String> fields) {
        Map<String,Object> properties = new LinkedHashMap<>();
        fields.forEach((name,type) -> { validateType(type); properties.put(name, Map.of("type",type)); });
        return Map.of("type","object","properties",properties,"required",List.copyOf(fields.keySet()),"additionalProperties",false);
    }
    private static void validateType(String type) {
        if (!List.of("string","integer","boolean").contains(type)) throw new IllegalArgumentException("UNSUPPORTED_CONTRACT_TYPE");
    }
    private static boolean valid(Map<String,Object> data, Map<String,String> fields, boolean exact) {
        if (data == null || exact && !data.keySet().equals(fields.keySet())) return false;
        for (var field : fields.entrySet()) {
            Object value=data.get(field.getKey());
            boolean matches=switch(field.getValue()) {
                case "string" -> value instanceof String;
                case "integer" -> value instanceof Integer || value instanceof Long;
                case "boolean" -> value instanceof Boolean;
                default -> false;
            };
            if (!matches) return false;
        }
        return true;
    }
}
