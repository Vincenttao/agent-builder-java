package local.agentbuilder.bridge;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;

class RegisteredHttpToolTest {
    @Test void readOnlyFailureIsReturnedToTheModelButWritesStillFailWithoutRetry() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/unavailable", exchange -> { calls.incrementAndGet(); exchange.sendResponseHeaders(503, -1); exchange.close(); });
        server.start();
        try {
            URI endpoint = URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/unavailable");
            var read = new RegisteredHttpTool("get_equipment", "read", endpoint, "test-token", Map.of(), Map.of("status", "string"), Duration.ofSeconds(2), true);
            assertThat(read.invoke(Map.of()).toString()).contains("tool-error", "TOOL_UNAVAILABLE");
            var write = new RegisteredHttpTool("create_work_order", "write", endpoint, "test-token", Map.of(), Map.of("status", "string"), Duration.ofSeconds(2), false);
            assertThatThrownBy(() -> write.invoke(Map.of())).hasMessage("TOOL_HTTP_STATUS:503");
            assertThat(calls.get()).isEqualTo(2);
        } finally { server.stop(0); }
    }
    @Test void callsRegisteredEndpointWithConnectionIdentityAndValidatesBothDirections() throws Exception {
        var requests = new CopyOnWriteArrayList<String>();
        var auth = new CopyOnWriteArrayList<String>();
        var events = new CopyOnWriteArrayList<Map<String,Object>>();
        AtomicInteger variant = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/equipment", exchange -> {
            requests.add(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            auth.add(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] body = (variant.get() == 0 ? "{\"equipmentId\":\"PUMP-001\",\"status\":\"warning\"}" : "{\"equipmentId\":\"PUMP-001\"}").getBytes();
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body); exchange.close();
        });
        server.start();
        try {
            var tool = new RegisteredHttpTool("get_equipment", "设备状态", URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/equipment"),
                    "fake-connection-sentinel", Map.of("equipmentId", "string"), Map.of("equipmentId", "string", "status", "string"), Duration.ofSeconds(2), false,
                    "enterprise-mock-http@1", "equipment-status-http@1", events::add);
            assertThat(tool.invoke(Map.of("equipmentId", "PUMP-001")).toString()).contains("warning");
            assertThat(events).singleElement().satisfies(event -> assertThat(event).containsEntry("event", "tool_call").containsEntry("protocol", "http")
                    .containsEntry("connectionRef", "enterprise-mock-http@1").containsEntry("toolVersion", "equipment-status-http@1")
                    .containsEntry("status", "succeeded").containsEntry("durationMs", ((Number)event.get("durationMs")).longValue()));
            assertThat(events.getFirst().get("parameterDigest")).isInstanceOf(String.class);
            assertThat(events.getFirst().get("resultDigest")).isInstanceOf(String.class);
            assertThat(auth).containsExactly("Bearer fake-connection-sentinel");
            assertThat(requests.getFirst()).contains("PUMP-001").doesNotContain("fake-connection-sentinel");
            assertThatThrownBy(() -> tool.invoke(Map.of())).hasMessage("TOOL_INPUT_CONTRACT_INVALID");
            assertThatThrownBy(() -> tool.invoke(Map.of("equipmentId", "PUMP-001", "url", "https://outside"))).hasMessage("TOOL_INPUT_CONTRACT_INVALID");
            assertThat(requests).hasSize(1);
            variant.set(1);
            assertThatThrownBy(() -> tool.invoke(Map.of("equipmentId", "PUMP-001"))).hasMessage("TOOL_RESPONSE_CONTRACT_INVALID");
            assertThat(requests).hasSize(2);
            assertThat(events).hasSize(2); assertThat(events.getLast()).containsEntry("status", "failed").containsEntry("errorCode", "TOOL_RESPONSE_CONTRACT_INVALID");
        } finally { server.stop(0); }
    }
}
