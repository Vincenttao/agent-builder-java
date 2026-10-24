package com.moaagent.compat;

import com.openjiuwen.core.session.AgentSession;
import com.openjiuwen.core.session.AgentSessionApi;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.harness.deep_agent.DeepAgentSession;
import com.openjiuwen.extensions.tracerotel.OtelRail;
import java.util.Map;

/** Reuses Core instrumentation while exposing its supported facade for DeepAgent sessions. */
public class DeepSessionOtelRail extends OtelRail {
    private void withFacade(AgentCallbackContext ctx,Runnable action){
        AgentSessionApi original=ctx.getSession();
        if(!(original instanceof DeepAgentSession deep)){action.run();return;}
        AgentSession facade=(AgentSession)ctx.getExtra().computeIfAbsent("workbench.otel.facade",key->new AgentSession(deep.getSessionId(),Map.of(),null){
            @Override public com.openjiuwen.core.session.internal.AgentSession getInner(){return deep.getInner();}
        });
        ctx.setSession(facade);
        try{action.run();}finally{ctx.setSession(original);}
    }
    @Override public void beforeInvoke(AgentCallbackContext c){withFacade(c,()->super.beforeInvoke(c));}
    @Override public void afterInvoke(AgentCallbackContext c){withFacade(c,()->super.afterInvoke(c));c.getExtra().remove("workbench.otel.facade");}
    @Override public void beforeModelCall(AgentCallbackContext c){withFacade(c,()->super.beforeModelCall(c));}
    @Override public void afterModelCall(AgentCallbackContext c){withFacade(c,()->super.afterModelCall(c));}
    @Override public void onModelException(AgentCallbackContext c){withFacade(c,()->super.onModelException(c));}
    @Override public void beforeToolCall(AgentCallbackContext c){withFacade(c,()->super.beforeToolCall(c));}
    @Override public void afterToolCall(AgentCallbackContext c){withFacade(c,()->super.afterToolCall(c));}
    @Override public void onToolException(AgentCallbackContext c){withFacade(c,()->super.onToolException(c));}
}
