package local.agentbuilder.bridge;

import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.ModelInvokeOptions;
import com.openjiuwen.core.foundation.llm.schema.AssistantMessage;
import com.openjiuwen.core.foundation.llm.schema.ToolCall;
import com.openjiuwen.core.foundation.tool.Tool;
import com.openjiuwen.core.foundation.tool.ToolCard;
import com.openjiuwen.harness.deep_agent.DeepAgent;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class AgentAssemblerTest {
    @TempDir Path workspace;

    @Test void rejectsUnsupportedTypeAndUnknownOrDuplicateRailsBeforeAssembly() {
        var assembler = new AgentAssembler();
        var model = mock(Model.class);
        for (var spec : List.of(spec("UnknownAgent", List.of("audit")), spec("DeepAgent", List.of("unknown")),
                spec("DeepAgent", List.of("audit", "audit")))) {
            assertThatThrownBy(() -> assembler.assemble(spec, workspace, model, List.of(), event -> {}))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(model);
    }

    @Test void realCoreLoopCallsToolAndBothRailsEmitEvents() {
        AtomicInteger modelCalls = new AtomicInteger();
        Model model = new Model((messages, config, client, options) ->
                CompletableFuture.completedFuture(modelCalls.getAndIncrement() == 0 ? AssistantMessage.builder().content("")
                        .toolCalls(List.of(ToolCall.builder().id("t1").name("get_equipment")
                                .arguments("{\"equipmentId\":\"PUMP-001\"}").build())).build()
                        : new AssistantMessage("已获取设备状态")));
        AtomicInteger calls = new AtomicInteger();
        Tool tool = new Tool(new ToolCard("equipment-v1", "get_equipment", "查询设备",
                Map.of("type", "object", "properties", Map.of("equipmentId", Map.of("type", "string")), "required", List.of("equipmentId")))) {
            @Override protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs) {
                assertThat(inputs).containsEntry("equipmentId", "PUMP-001");
                calls.incrementAndGet();
                return Map.of("equipmentId", "PUMP-001", "status", "warning");
            }
        };
        List<Map<String, Object>> events = new CopyOnWriteArrayList<>();
        DeepAgent agent = new AgentAssembler().assemble(spec("DeepAgent", List.of("audit", "tool-allowlist")), workspace, model, List.of(tool), events::add);
        try {
            var output = agent.invoke(Map.of("query", "分析 PUMP-001", "conversation_id", "session-1"));
            assertThat(output.toString()).contains("已获取设备状态");
            assertThat(calls.get()).isEqualTo(1);
            assertThat(events).anySatisfy(e -> assertThat(e).containsEntry("rail", "audit").containsEntry("event", "before_invoke"));
            assertThat(events).anySatisfy(e -> assertThat(e).containsEntry("rail", "tool-allowlist").containsEntry("event", "before_tool_call"));
        } finally { agent.destroy(); }
    }

    private AgentSpec spec(String type, List<String> rails) {
        return new AgentSpec("test-" + UUID.randomUUID(), type, "你是设备助手。只能使用已登记工具，不编造结果。", 4, rails);
    }

    @Test void railStopsAnUnboundToolBeforeItsImplementationRuns() {
        Model model = new Model((messages, config, client, options) -> CompletableFuture.completedFuture(
                AssistantMessage.builder().content("").toolCalls(List.of(ToolCall.builder().id("denied-1").name("unbound_tool").arguments("{}").build())).build()));
        AtomicInteger effects = new AtomicInteger();
        List<Map<String, Object>> events = new CopyOnWriteArrayList<>();
        DeepAgent agent = new AgentAssembler().assemble(spec("DeepAgent", List.of("audit", "tool-allowlist")), workspace, model, List.of(), events::add);
        agent.registerTool(new Tool(new ToolCard("unbound-tool", "unbound_tool", "Not authorized", Map.of("type", "object", "properties", Map.of()))) {
            @Override protected Object invokeInternal(Map<String, Object> inputs, Map<String, Object> kwargs) { effects.incrementAndGet(); return "unexpected"; }
        });
        try {
            assertThat(agent.invoke(Map.of("query", "try unbound tool", "conversation_id", "deny-session")).toString()).contains("TOOL_NOT_ALLOWED");
            assertThat(effects.get()).isZero();
            assertThat(events).anySatisfy(e -> assertThat(e).containsEntry("rail", "tool-allowlist").containsEntry("allowed", false));
        } finally { agent.destroy(); }
    }

    @Test void interleavedSessionsKeepRailStateSeparate() {
        Model model = new Model((messages, config, client, options) -> CompletableFuture.completedFuture(new AssistantMessage("ok")));
        List<Map<String, Object>> events = new CopyOnWriteArrayList<>();
        DeepAgent agent = new AgentAssembler().assemble(spec("DeepAgent", List.of("audit", "tool-allowlist")), workspace, model, List.of(), events::add);
        try {
            for (String session : List.of("alpha", "beta", "alpha")) agent.invoke(Map.of("query", "hello", "conversation_id", session));
            var starts = events.stream().filter(e -> "before_invoke".equals(e.get("event"))).toList();
            assertThat(starts).extracting(e -> e.get("sessionId")).containsExactly("alpha", "beta", "alpha");
            assertThat(starts).extracting(e -> e.get("turnCount")).containsExactly(1, 1, 2);
        } finally { agent.destroy(); }
    }
}
