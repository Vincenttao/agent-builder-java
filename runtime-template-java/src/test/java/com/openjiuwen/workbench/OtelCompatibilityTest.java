package com.openjiuwen.workbench;
import com.moaagent.compat.DeepSessionOtelRail;
import com.openjiuwen.harness.deep_agent.DeepAgentSession;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.InvokeInputs;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class OtelCompatibilityTest {
 @Test void deepAgentSessionReceivesNativeRootTraceLifecycle(){
  var session=new DeepAgentSession("otel-compat-"+java.util.UUID.randomUUID());
  var inputs=new InvokeInputs();inputs.setQuery("read-only trace fixture");
  var context=AgentCallbackContext.builder().session(session).inputs(inputs).build();
  var rail=new DeepSessionOtelRail();rail.beforeInvoke(context);
  assertNotNull(context.getExtra().get("_otel_root_span"),"Core OtelRail must reach the DeepAgentSession tracer");
  rail.afterInvoke(context);assertFalse(context.getExtra().containsKey("_otel_root_span"));
 }
}
