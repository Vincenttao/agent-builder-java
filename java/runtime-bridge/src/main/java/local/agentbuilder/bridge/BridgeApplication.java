package local.agentbuilder.bridge;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.modelclients.DefaultModelClientFactories;
import com.openjiuwen.core.foundation.llm.schema.ModelClientConfig;
import com.openjiuwen.core.foundation.llm.schema.ModelRequestConfig;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.harness.deep_agent.DeepAgent;
import com.openjiuwen.service.adapters.agentcore.agentfw.JiuwenCoreAgentHandler;
import com.openjiuwen.service.spec.spi.AgentHandler;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.core.env.Environment;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.Instant;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/** One immutable configuration per JVM, hosted by the upstream AgentServer. */
@SpringBootApplication
public class BridgeApplication {
    public record ToolDescriptor(String name, String description, String operationId,
                                 Map<String, String> inputFields, Map<String, String> responseFields,
                                 String protocol, String connectionRef, String remoteToolName, String toolVersion) {}
    public record Configuration(AgentSpec agent, List<ToolDescriptor> tools) {
        public Configuration { tools = List.copyOf(tools); }
    }
    public record LoadedCandidate(Configuration configuration, String specDigest) {}
    public static void main(String[] args) { SpringApplication.run(BridgeApplication.class, args); }

    @Bean LoadedCandidate loadedCandidate(Environment env) throws Exception {
        byte[] data = Files.readAllBytes(Path.of(env.getRequiredProperty("builder.spec")));
        return new LoadedCandidate(new ObjectMapper().readValue(data, Configuration.class),
                HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)));
    }
    @Bean Configuration candidateConfiguration(LoadedCandidate candidate) { return candidate.configuration(); }
    @Bean GeneratedComponents generatedComponents(LoadedCandidate candidate, Environment env) throws Exception {
        return GeneratedComponents.load(BridgeApplication.class.getClassLoader(), Path.of(env.getRequiredProperty("builder.workspace")), candidate.specDigest());
    }

    @Bean Model model(Environment env) {
        String key = env.getRequiredProperty("builder.model-key");
        if (key.isBlank()) throw new IllegalArgumentException("MODEL_NOT_CONFIGURED");
        DefaultModelClientFactories.ensureRegistered();
        return new Model(ModelClientConfig.builder().clientProvider("OpenAI").apiKey(key)
                .apiBase(env.getProperty("builder.model-base", "https://api.deepseek.com/v1"))
                .timeout(40.0).connectTimeoutSeconds(10.0).verifySsl(true).build(),
                ModelRequestConfig.builder().modelName(env.getProperty("builder.model-name", "deepseek-v4-flash"))
                        .temperature(0.0).maxTokens(1024).extraFields(Map.of("thinking", Map.of("type", "disabled"))).build());
    }

    @Bean SessionExecutions sessionExecutions() { return new SessionExecutions(); }
    @Bean(destroyMethod = "destroy") DeepAgent agent(Configuration config, Model model, Environment env, SessionExecutions executions, GeneratedComponents components) throws Exception {
        Path workspace = Path.of(env.getRequiredProperty("builder.workspace"));
        Path events = Path.of(env.getRequiredProperty("builder.events")).toAbsolutePath();
        Files.createDirectories(events.getParent());
        Files.createDirectories(workspace);
        ObjectMapper json = new ObjectMapper();
        Object lock = new Object();
        Consumer<Map<String, Object>> sink = event -> {
            synchronized (lock) {
                try {
                    String encoded = json.writeValueAsString(Map.of("time", Instant.now().toString(), "event", event));
                    for (String name : List.of("builder.model-key", "builder.runtime-token", "builder.proxy-token")) {
                        String secret = env.getProperty(name, "");
                        if (!secret.isBlank()) encoded = encoded.replace(secret, "[REDACTED]");
                    }
                    Files.writeString(events, encoded + "\n",
                            StandardOpenOption.CREATE, StandardOpenOption.APPEND);
                } catch (Exception error) { throw new IllegalStateException("EVIDENCE_WRITE_FAILED"); }
            }
        };
        List<Tool> tools = new ArrayList<>();
        for (ToolDescriptor descriptor : config.tools()) {
            if (!validOperationId(descriptor.operationId())) throw new IllegalArgumentException("INVALID_OPERATION_ID");
            if (components.enabled() && !components.binds(descriptor.name(), descriptor.operationId())) throw new IllegalArgumentException("GENERATED_TOOL_BINDING_INVALID");
            Tool transport;
            if ("mcp".equals(descriptor.protocol())) {
                if (!"enterprise-mock-mcp@1".equals(descriptor.connectionRef()) || descriptor.remoteToolName() == null || components.enabled())
                    throw new IllegalArgumentException("UNSUPPORTED_MCP_CONNECTION");
                URI endpoint = URI.create(env.getRequiredProperty("builder.proxy-base") + "/mcp");
                transport = new RegisteredMcpTool(descriptor.name(), descriptor.description(), endpoint,
                        env.getRequiredProperty("builder.proxy-token"), descriptor.remoteToolName(), descriptor.connectionRef(), descriptor.toolVersion(),
                        descriptor.inputFields(), descriptor.responseFields(), Duration.ofSeconds(5), sink);
            } else {
                if (descriptor.protocol() != null && !"http".equals(descriptor.protocol())) throw new IllegalArgumentException("UNSUPPORTED_TOOL_PROTOCOL");
                URI endpoint = URI.create(env.getRequiredProperty("builder.proxy-base") + "/operations/" + descriptor.operationId());
                transport = new RegisteredHttpTool(descriptor.name(), descriptor.description(), endpoint,
                        env.getRequiredProperty("builder.proxy-token"), descriptor.inputFields(), descriptor.responseFields(), Duration.ofSeconds(5),
                        !components.enabled() && "equipment-status".equals(descriptor.operationId()),
                        descriptor.connectionRef() == null ? "enterprise-mock-http@1" : descriptor.connectionRef(),
                        descriptor.toolVersion() == null ? descriptor.operationId() + "@1" : descriptor.toolVersion(), sink);
            }
            tools.add(components.enabled() ? components.wrap(transport, sink) : transport);
        }
        return new AgentAssembler().assemble(config.agent(), workspace, model, tools, sink, executions, components);
    }

    @Bean AgentHandler agentHandler(DeepAgent agent, SessionExecutions executions) { return new ManagedAgentHandler(new JiuwenCoreAgentHandler(agent), executions); }

    static boolean validOperationId(String value) {
        return value != null && value.matches("[a-z][a-zA-Z0-9-]{0,63}");
    }
}
