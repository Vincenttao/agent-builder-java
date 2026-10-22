package local.agentbuilder.bridge;

import com.openjiuwen.harness.deep_agent.DeepAgent;
import org.springframework.boot.system.ApplicationHome;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.core.env.Environment;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;

/** Reports the bytes actually loaded by this process; a caller-supplied digest is never trusted. */
@RestController
public final class BridgeManifestController {
    private final Map<String, Object> manifest;
    public BridgeManifestController(BridgeApplication.LoadedCandidate loaded, DeepAgent agent, Environment env, GeneratedComponents components) throws Exception {
        var source = new ApplicationHome(BridgeApplication.class).getSource();
        String digest = "";
        if (source != null && source.isFile()) {
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            try (var input = Files.newInputStream(source.toPath())) {
                byte[] block = new byte[16384];
                int size;
                while ((size = input.read(block)) != -1) hash.update(block, 0, size);
            }
            digest = HexFormat.of().formatHex(hash.digest());
        }
        var values = new java.util.LinkedHashMap<String, Object>(Map.of("agentId", agent.getCard().getId(), "agentType", "DeepAgent",
                "specDigest", loaded.specDigest(), "artifactDigest", digest,
                "rails", loaded.configuration().agent().rails(),
                "tools", loaded.configuration().tools().stream().map(BridgeApplication.ToolDescriptor::name).toList(),
                "coreVersion", "0.1.17", "runtimeVersion", "0.1.4",
                "sessionStorage", "in_memory", "restartRecovery", "unsupported"));
        values.put("modelProfile", Map.of("provider", "OpenAI", "baseUrl", env.getProperty("builder.model-base", "https://api.deepseek.com/v1"),
                "name", env.getProperty("builder.model-name", "deepseek-v4-flash"), "temperature", 0, "maxTokens", 1024, "thinking", "disabled"));
        if (components.enabled()) values.put("generated", components.manifest());
        manifest = Map.copyOf(values);
    }
    @GetMapping("/bridge/manifest") public Map<String, Object> manifest() { return manifest; }
}
