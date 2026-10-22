package local.agentbuilder.bridge;

import com.openjiuwen.core.foundation.llm.schema.ToolCall;
import com.openjiuwen.core.singleagent.interrupt.InterruptRequest;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.harness.rails.interrupt.BaseInterruptRail;
import com.openjiuwen.harness.rails.interrupt.InterruptDecision;
import java.util.Collection;
import java.util.Map;
import java.util.function.Consumer;

/** Native SDK pause/resume. Authorization is independently rechecked by the platform write proxy. */
public final class WriteConfirmationRail extends BaseInterruptRail {
    private final Consumer<Map<String, Object>> events;
    public WriteConfirmationRail(Collection<String> tools, Consumer<Map<String, Object>> events) { super(tools); this.events = events; }
    @Override protected InterruptDecision resolveInterrupt(AgentCallbackContext context, ToolCall tool, Object input) {
        boolean approved = input instanceof Map<?, ?> value && Boolean.TRUE.equals(value.get("approved"));
        events.accept(Map.of("rail", "write-confirm", "event", input == null ? "approval_required" : "approval_resumed", "toolCallId", tool.getId(), "tool", tool.getName(), "sessionId", context.getSession().getSessionId(), "approved", approved));
        if (input == null) return interrupt(new InterruptRequest("请确认以下模拟写入操作", Map.of("type", "object", "properties", Map.of("approved", Map.of("type", "boolean")), "required", java.util.List.of("approved")), ""));
        return approved ? approve() : reject("用户拒绝本次写入");
    }
}
