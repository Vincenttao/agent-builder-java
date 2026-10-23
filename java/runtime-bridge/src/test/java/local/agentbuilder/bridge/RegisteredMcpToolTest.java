package local.agentbuilder.bridge;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import com.openjiuwen.core.session.AgentSessionApi;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class RegisteredMcpToolTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test void preservesAnEnterpriseReverseProxyPathPrefix() throws Exception {
        var seen = new CopyOnWriteArrayList<String>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/tool-proxy/mcp", exchange -> {
            JsonNode request = JSON.readTree(exchange.getRequestBody()); String method = request.path("method").asText(); seen.add(method);
            if (method.startsWith("notifications/")) { exchange.sendResponseHeaders(202, -1); exchange.close(); return; }
            Object result = switch (method) {
                case "initialize" -> Map.of("protocolVersion", "2025-03-26", "capabilities", Map.of("tools", Map.of()), "serverInfo", Map.of("name", "proxy-mcp", "version", "1"));
                case "tools/list" -> Map.of("tools", List.of(Map.of("name", "equipment_status", "_meta", Map.of("version", "equipment-status-mcp@1"), "inputSchema", Map.of("type", "object", "properties", Map.of("equipmentId", Map.of("type", "string")), "required", List.of("equipmentId"), "additionalProperties", false))));
                case "tools/call" -> Map.of("content", List.of(Map.of("type", "text", "text", "{\"status\":\"warning\"}")), "structuredContent", Map.of("status", "warning"), "isError", false);
                default -> Map.of("error", Map.of("code", -32601, "message", "unsupported"));
            };
            byte[] body = JSON.writeValueAsBytes(Map.of("jsonrpc", "2.0", "id", request.get("id"), "result", result));
            exchange.getResponseHeaders().set("Content-Type", "application/json"); exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); exchange.close();
        }); server.start();
        AgentSessionApi session = mock(AgentSessionApi.class); when(session.getSessionId()).thenReturn("e0131ad8-0000-4000-8000-000000000002");
        var tool = new RegisteredMcpTool("get_equipment_mcp", "read", URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/internal/tool-proxy/mcp"),
                "valid-token", "equipment_status", "enterprise-mock-mcp@1", "equipment-status-mcp@1", Map.of("equipmentId", "string"), Map.of("status", "string"), Duration.ofSeconds(3), event -> {});
        try {
            assertThat(tool.invoke(Map.of("equipmentId", "PUMP-001"), Map.of("session", session))).isEqualTo(Map.of("status", "warning"));
            assertThat(seen).contains("initialize", "tools/list", "tools/call");
        } finally { server.stop(0); }
    }

    @Test void discoversAndCallsOnlyTheRegisteredRemoteMcpTool() throws Exception {
        var methods = new CopyOnWriteArrayList<String>();
        var auth = new CopyOnWriteArrayList<String>();
        var sessionIds = new CopyOnWriteArrayList<String>();
        var calledArguments = new CopyOnWriteArrayList<JsonNode>();
        var evidence = new CopyOnWriteArrayList<Map<String,Object>>();
        var versionMatches = new AtomicBoolean(true);
        var validResult = new AtomicBoolean(true);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/mcp", exchange -> {
            auth.add(exchange.getRequestHeaders().getFirst("Authorization"));
            sessionIds.add(exchange.getRequestHeaders().getFirst("X-Builder-Session-Id"));
            JsonNode request = JSON.readTree(exchange.getRequestBody());
            String method = request.path("method").asText(); methods.add(method);
            if (method.equals("tools/call")) calledArguments.add(request.path("params").path("arguments"));
            if (method.startsWith("notifications/")) { exchange.sendResponseHeaders(202, -1); exchange.close(); return; }
            JsonNode id = request.get("id");
            Object result = switch (method) {
                case "initialize" -> Map.of("protocolVersion", "2025-03-26", "capabilities", Map.of("tools", Map.of()), "serverInfo", Map.of("name", "fixture-mcp", "version", "1.2.3"));
                case "tools/list" -> Map.of("tools", List.of(Map.of("name", "equipment_status", "description", "query mock equipment", "_meta", Map.of("version", versionMatches.get() ? "equipment-status-mcp@1" : "equipment-status-mcp@2"),
                        "inputSchema", Map.of("type", "object", "properties", Map.of("equipmentId", Map.of("type", "string")), "required", List.of("equipmentId"), "additionalProperties", false))));
                case "tools/call" -> Map.of("content", List.of(Map.of("type", "text", "text", "{\"equipmentId\":\"PUMP-001\",\"status\":\"warning\"}")), "structuredContent", validResult.get() ? Map.of("equipmentId", "PUMP-001", "status", "warning") : Map.of("equipmentId", "PUMP-001"), "isError", false);
                default -> Map.of("error", Map.of("code", -32601, "message", "Method not found"));
            };
            byte[] body = JSON.writeValueAsBytes(Map.of("jsonrpc", "2.0", "id", id, "result", result));
            exchange.getResponseHeaders().set("Content-Type", "application/json"); exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body); exchange.close();
        });
        server.start();
        try {
            var tool = new RegisteredMcpTool("get_equipment", "Read equipment through MCP", URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/mcp"),
                    "fake-mcp-connection", "equipment_status", "enterprise-mock-mcp@1", "equipment-status-mcp@1", Map.of("equipmentId", "string"),
                    Map.of("equipmentId", "string", "status", "string"), Duration.ofSeconds(3), evidence::add);
            AgentSessionApi session = mock(AgentSessionApi.class); when(session.getSessionId()).thenReturn("e0131ad8-0000-4000-8000-000000000002");
            assertThat(tool.invoke(Map.of("equipmentId", "PUMP-001"), Map.of("session", session)).toString()).contains("PUMP-001", "warning");
            assertThat(methods).contains("initialize", "tools/list", "tools/call");
            assertThat(calledArguments).singleElement().isEqualTo(JSON.readTree("{\"equipmentId\":\"PUMP-001\"}"));
            assertThat(auth).containsOnly("Bearer fake-mcp-connection");
            assertThat(sessionIds).containsOnly("e0131ad8-0000-4000-8000-000000000002");
            assertThat(evidence).singleElement().satisfies(event -> {
                assertThat(event).containsEntry("event", "mcp_tool_call").containsEntry("connectionRef", "enterprise-mock-mcp@1")
                        .containsEntry("toolVersion", "equipment-status-mcp@1").containsEntry("serverVersion", "1.2.3")
                        .containsEntry("status", "succeeded").containsEntry("sessionId", "e0131ad8-0000-4000-8000-000000000002");
                assertThat(event.get("parameterDigest")).isInstanceOf(String.class);
                assertThat(event.get("resultDigest")).isInstanceOf(String.class);
                assertThat(event.get("durationMs")).isInstanceOf(Number.class);
            });
            validResult.set(false);
            assertThatThrownBy(() -> tool.invoke(Map.of("equipmentId", "PUMP-001"), Map.of("session", session))).hasMessage("MCP_RESPONSE_CONTRACT_INVALID");
            versionMatches.set(false);
            assertThatThrownBy(() -> tool.invoke(Map.of("equipmentId", "PUMP-001"), Map.of("session", session))).hasMessage("MCP_TOOL_VERSION_MISMATCH");
            assertThatThrownBy(() -> tool.invoke(Map.of("equipmentId", "PUMP-001", "endpoint", "https://outside")))
                    .hasMessage("TOOL_INPUT_CONTRACT_INVALID");
        } finally { server.stop(0); }
    }

    @Test void classifiesRemoteAuthenticationAndProtocolFailuresSeparately() throws Exception {
        AgentSessionApi session = mock(AgentSessionApi.class); when(session.getSessionId()).thenReturn("e0131ad8-0000-4000-8000-000000000002");
        HttpServer authServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        authServer.createContext("/mcp", exchange -> { exchange.sendResponseHeaders(401, -1); exchange.close(); }); authServer.start();
        var unauthorized = new RegisteredMcpTool("get_equipment", "read", URI.create("http://127.0.0.1:" + authServer.getAddress().getPort() + "/mcp"),
                "bad-token", "equipment_status", Map.of("equipmentId", "string"), Map.of("status", "string"), Duration.ofSeconds(3));
        try { assertThatThrownBy(() -> unauthorized.invoke(Map.of("equipmentId", "PUMP-001"), Map.of("session", session))).hasMessage("MCP_AUTHENTICATION_FAILED"); }
        finally { authServer.stop(0); }

        HttpServer protocolServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        protocolServer.createContext("/mcp", exchange -> { exchange.sendResponseHeaders(400, -1); exchange.close(); }); protocolServer.start();
        var unsupported = new RegisteredMcpTool("get_equipment", "read", URI.create("http://127.0.0.1:" + protocolServer.getAddress().getPort() + "/mcp"),
                "valid-token", "equipment_status", Map.of("equipmentId", "string"), Map.of("status", "string"), Duration.ofSeconds(3));
        try { assertThatThrownBy(() -> unsupported.invoke(Map.of("equipmentId", "PUMP-001"), Map.of("session", session))).hasMessage("MCP_PROTOCOL_UNSUPPORTED"); }
        finally { protocolServer.stop(0); }
    }
}
