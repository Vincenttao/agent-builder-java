package local.agentbuilder.bridge;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.SpringApplication;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;

/** Real SDK interruption/resume contract. The model is a local deterministic test server. */
class ApprovalBridgeTest {
    @TempDir Path directory;
    private static final ObjectMapper JSON = new ObjectMapper();
    @Test void resumesThePendingToolWithoutRepeatingTheReadOrOriginalModelRequest() throws Exception {
        AtomicInteger models = new AtomicInteger(); AtomicInteger reads = new AtomicInteger(); AtomicInteger writes = new AtomicInteger();
        String sessionId = UUID.randomUUID().toString();
        HttpServer external = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        external.createContext("/v1/chat/completions", exchange -> {
            exchange.getRequestBody().readAllBytes(); int n = models.incrementAndGet();
            Map<String, Object> message = switch (n) {
                case 1 -> tool("call-read", "get_equipment", Map.of("equipmentId", "PUMP-001"), "查询设备事实");
                case 2 -> tool("call-write", "create_work_order", Map.of("equipmentId", "PUMP-001", "description", "检查温度告警", "priority", "normal"), "设备温度 86°C，建议创建检查工单。");
                default -> Map.of("role", "assistant", "content", "已创建工单 WO-001，保留设备温度告警分析。");
            };
            byte[] bytes = JSON.writeValueAsBytes(Map.of("id", "fixture", "model", "fixture", "choices", List.of(Map.of("index", 0, "message", message, "finish_reason", n < 3 ? "tool_calls" : "stop"))));
            exchange.getResponseHeaders().set("Content-Type", "application/json"); exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        });
        external.createContext("/operations/equipment-status", exchange -> {
            reads.incrementAndGet(); byte[] bytes = "{\"equipmentId\":\"PUMP-001\",\"status\":\"warning\"}".getBytes();
            exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        });
        external.createContext("/operations/work-order-create", exchange -> {
            assertThat(exchange.getRequestHeaders().getFirst("X-Builder-Session-Id")).isEqualTo(sessionId);
            assertThat(exchange.getRequestHeaders().getFirst("X-Builder-Tool-Call-Id")).isEqualTo("call-write");
            writes.incrementAndGet(); byte[] bytes = "{\"workOrderId\":\"WO-001\",\"status\":\"created\"}".getBytes();
            exchange.sendResponseHeaders(200, bytes.length); exchange.getResponseBody().write(bytes); exchange.close();
        });
        external.start();
        Path spec = directory.resolve("spec.json");
        Files.writeString(spec, """
          {"agent":{"id":"approval-http","type":"DeepAgent","systemPrompt":"先查询设备，再创建工单。","maxIterations":5,"rails":["audit","tool-allowlist","write-confirm"]},
          "tools":[{"name":"get_equipment","description":"查询设备","operationId":"equipment-status","inputFields":{"equipmentId":"string"},"responseFields":{"equipmentId":"string","status":"string"}},
          {"name":"create_work_order","description":"创建 Mock 工单，必须批准","operationId":"work-order-create","inputFields":{"equipmentId":"string","description":"string","priority":"string"},"responseFields":{"workOrderId":"string","status":"string"}}]}
          """);
        String externalBase = "http://127.0.0.1:" + external.getAddress().getPort();
        Map<String, String> settings = Map.of("server.port", "0", "builder.spec", spec.toString(), "builder.workspace", directory.resolve("workspace").toString(),
            "builder.events", directory.resolve("events.jsonl").toString(), "builder.runtime-token", "approval-runtime-token-0123456789", "builder.proxy-token", "test-proxy",
            "builder.proxy-base", externalBase, "builder.model-base", externalBase + "/v1", "builder.model-key", "fixture-key");
        try (var app = new SpringApplication(BridgeApplication.class).run(settings.entrySet().stream().map(e -> "--" + e.getKey() + "=" + e.getValue()).toArray(String[]::new))) {
            String base = "http://127.0.0.1:" + app.getEnvironment().getProperty("local.server.port");
            var first = post(base + "/v1/query", Map.of("message", "查询 PUMP-001 并申请工单", "conversation_id", sessionId, "stream", false));
            assertThat(first.statusCode()).as(first.body()).isEqualTo(200);
            assertThat(first.body()).contains("_interrupt", "call-write", "create_work_order");
            Files.writeString(Path.of("target/approval-contract-response.json"), first.body());
            assertThat(reads).hasValue(1); assertThat(writes).hasValue(0); assertThat(models).hasValue(2);
            var second = post(base + "/bridge/resume", Map.of("sessionId", sessionId, "toolCallId", "call-write", "approved", true));
            assertThat(second.statusCode()).as(second.body()).isEqualTo(200); assertThat(second.body()).contains("WO-001");
            assertThat(reads).hasValue(1); assertThat(writes).hasValue(1); assertThat(models).hasValue(3);
            Files.writeString(directory.resolve("interrupt-response.json"), first.body());
            assertThat(Files.readString(directory.resolve("events.jsonl"))).contains("approval_required", "approval_resumed", "call-write", "设备温度 86°C，建议创建检查工单。");
        } finally { external.stop(0); }
    }
    private static Map<String, Object> tool(String id, String name, Map<String, Object> args, String content) throws java.io.IOException {
        return Map.of("role", "assistant", "content", content, "tool_calls", List.of(Map.of("id", id, "type", "function", "function", Map.of("name", name, "arguments", JSON.writeValueAsString(args)))));
    }
    private static HttpResponse<String> post(String url, Object body) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(30))
            .header("Authorization", "Bearer approval-runtime-token-0123456789").header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString());
    }
}
