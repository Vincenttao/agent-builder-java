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
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;

/** Real AgentServer/Core/HTTP, deterministic model server. This is NOT live-model acceptance. */
class BridgeHttpTest {
    @TempDir Path directory;
    @Test void realAgentServerInvokesCoreAndToolWithAuthenticatedIngress() throws Exception {
        AtomicInteger modelCalls = new AtomicInteger();
        AtomicInteger toolCalls = new AtomicInteger();
        HttpServer external = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        external.createContext("/v1/chat/completions", exchange -> {
            exchange.getRequestBody().readAllBytes();
            int n = modelCalls.incrementAndGet();
            String message = n == 1 ? "{\"role\":\"assistant\",\"content\":\"\",\"tool_calls\":[{\"id\":\"call-1\",\"type\":\"function\",\"function\":{\"name\":\"get_equipment\",\"arguments\":\"{\\\"equipmentId\\\":\\\"PUMP-001\\\"}\"}}]}"
                    : "{\"role\":\"assistant\",\"content\":\"PUMP-001 status is warning from mock-maintenance-v1\"}";
            byte[] body = ("{\"id\":\"model-1\",\"model\":\"test-model\",\"choices\":[{\"index\":0,\"message\":" + message + ",\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":10,\"total_tokens\":20}}").getBytes();
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); exchange.close();
        });
        external.createContext("/operations/equipment-status", exchange -> {
            assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isEqualTo("Bearer fake-proxy-token");
            assertThat(exchange.getRequestHeaders().getFirst("X-Builder-Session-Id")).isEqualTo("http-session");
            assertThat(new String(exchange.getRequestBody().readAllBytes())).contains("PUMP-001");
            toolCalls.incrementAndGet();
            byte[] body = "{\"equipmentId\":\"PUMP-001\",\"status\":\"warning\",\"source\":\"mock-maintenance-v1\"}".getBytes();
            exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); exchange.close();
        });
        external.start();
        Path spec = directory.resolve("spec.json");
        Files.writeString(spec, """
          {"agent":{"id":"bridge-http-test","type":"DeepAgent","systemPrompt":"Use get_equipment for the provided equipment id. Cite its source.","maxIterations":4,"rails":["audit","tool-allowlist"]},
           "tools":[{"name":"get_equipment","description":"Equipment status","operationId":"equipment-status","inputFields":{"equipmentId":"string"},"responseFields":{"equipmentId":"string","status":"string","source":"string"}}]}
          """);
        SpringApplication app = new SpringApplication(BridgeApplication.class);
        Map<String, String> settings = Map.of("server.port", "0", "builder.spec", spec.toString(), "builder.workspace", directory.resolve("workspace").toString(),
                "builder.events", directory.resolve("events.jsonl").toString(), "builder.runtime-token", "fake-runtime-token-long-enough",
                "builder.proxy-token", "fake-proxy-token", "builder.proxy-base", "http://127.0.0.1:" + external.getAddress().getPort(),
                "builder.model-base", "http://127.0.0.1:" + external.getAddress().getPort() + "/v1", "builder.model-key", "fake-model-key");
        try (var context = app.run(settings.entrySet().stream().map(e -> "--" + e.getKey() + "=" + e.getValue()).toArray(String[]::new))) {
            String base = "http://127.0.0.1:" + context.getEnvironment().getProperty("local.server.port");
            var client = HttpClient.newHttpClient();
            assertThat(client.send(HttpRequest.newBuilder(URI.create(base + "/health")).GET().build(), HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(401);
            var manifestResponse = client.send(HttpRequest.newBuilder(URI.create(base + "/bridge/manifest"))
                    .header("Authorization", "Bearer fake-runtime-token-long-enough").GET().build(), HttpResponse.BodyHandlers.ofString());
            assertThat(manifestResponse.statusCode()).isEqualTo(200);
            var manifest = new ObjectMapper().readTree(manifestResponse.body());
            assertThat(manifest.get("specDigest").asText()).isEqualTo(java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(spec))));
            assertThat(manifest.get("agentId").asText()).isEqualTo("bridge-http-test");
            assertThat(manifest.get("artifactDigest").asText()).isEmpty(); // Test classes are not a deliverable JAR.
            var request = HttpRequest.newBuilder(URI.create(base + "/v1/query")).timeout(Duration.ofSeconds(30))
                    .header("Authorization", "Bearer fake-runtime-token-long-enough").header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString("{\"message\":\"Analyze PUMP-001\",\"conversation_id\":\"http-session\",\"stream\":false}")).build();
            var response = client.send(request, HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).as(response.body()).isEqualTo(200);
            assertThat(response.body()).contains("warning", "mock-maintenance-v1");
            assertThat(modelCalls.get()).isEqualTo(2);
            assertThat(toolCalls.get()).isEqualTo(1);
            assertThat(Files.readString(directory.resolve("events.jsonl"))).contains("before_tool_call").doesNotContain("fake-model-key", "fake-proxy-token");
        } finally { external.stop(0); }
    }
}
