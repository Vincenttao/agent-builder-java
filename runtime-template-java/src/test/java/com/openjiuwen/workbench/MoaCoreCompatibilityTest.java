package com.openjiuwen.workbench;

import com.moaagent.agent.skill.*;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.session.AgentSession;
import com.openjiuwen.core.foundation.llm.schema.ToolCall;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.ToolCallInputs;
import com.openjiuwen.core.singleagent.interrupt.InterruptConstants;
import com.openjiuwen.core.singleagent.interrupt.ToolInterruptException;
import com.openjiuwen.service.adapters.agentcore.ext.context.ResponseMetadataAccessor;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.Path;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class MoaCoreCompatibilityTest {
    @TempDir Path root;
    AgentSession session;
    SkillActionRail rail;
    AtomicInteger writes;
    @BeforeEach void setup() throws Exception {
        Files.createDirectories(root.resolve("entry"));
        Files.writeString(root.resolve("entry/SKILL.md"),"---\nname: entry\ndescription: test\n---\n业务指导");
        Files.writeString(root.resolve("operation.py"),"trusted-operation");
        session=new AgentSession("compat-"+UUID.randomUUID(),Map.of(ResponseMetadataAccessor.RESPONSE_METADATA,new LinkedHashMap<>()),null);
        var state=new SkillSession();state.setExecutionId("execution");state.setParentId("task-a");state.setQuery("兑换礼品");state.save(session);
        var schema=Map.<String,Object>of("type","object","properties",Map.of("value",Map.of("type","string")),"required",List.of("value"),"additionalProperties",false);
        var op=new SkillOperation(SkillOperation.Type.SCRIPT,"兑换礼品",null,null,null,null,"operation.py",schema,schema,Map.of(),true,false,3);
        writes=new AtomicInteger();
        rail=new SkillActionRail(new SkillAssets(root.toString(),"entry"),Map.of("redeem",op),(scope,source,input)->{
            writes.incrementAndGet();return Map.of("success",true,"data",Map.of("value","cup"),"model_data",Map.of());
        });
    }
    String call(String id,String tool,String value,Object response){
        String args=Json.write(Map.of("operation","redeem","arguments",Map.of("value",value)));
        var inputs=new ToolCallInputs();inputs.setToolCall(ToolCall.builder().id(id).name(tool).arguments(args).build());inputs.setToolName(tool);inputs.setToolArgs(args);
        var extra=new HashMap<String,Object>();if(response!=null)extra.put(InterruptConstants.RESUME_USER_INPUT_KEY,Map.of(id,response));
        rail.beforeToolCall(AgentCallbackContext.builder().session(session).inputs(inputs).extra(extra).build());
        return String.valueOf(inputs.getToolResult());
    }
    @Test void nativeConfirmationBindsParametersAndReplayingReceiptDoesNotRepeatWrite(){
        call("unconfirmed","call_mcp","cup",null);assertEquals(0,writes.get());
        var question=assertThrows(ToolInterruptException.class,()->call("approval","confirm_action","cup",null));
        assertTrue(question.getRequest().getMessage().contains("确认"));assertEquals(0,writes.get());
        call("approval","confirm_action","cup","确认");assertEquals(0,writes.get());
        call("changed","call_mcp","bag",null);assertEquals(0,writes.get());
        // A changed-parameter attempt consumes the original approval: a fresh confirmation is required.
        assertThrows(ToolInterruptException.class,()->call("approval-new","confirm_action","cup",null));
        call("approval-new","confirm_action","cup","确认");
        String receipt=call("write-1","call_mcp","cup",null);assertEquals(1,writes.get());
        assertTrue(receipt.contains("success"));
        assertEquals(receipt,call("write-1","call_mcp","cup",null));assertEquals(1,writes.get());
    }
    @Test void businessBoundaryRegistersNativeInvokeLifecycleOnCore017(){
        assertTrue(new SkillBoundaryRail().getCallbacks().containsKey(com.openjiuwen.core.singleagent.rail.AgentCallbackEvent.BEFORE_INVOKE));
    }
    @Test void rejectionHasZeroBusinessWrites(){
        assertThrows(ToolInterruptException.class,()->call("approval","confirm_action","cup",null));
        call("approval","confirm_action","cup","拒绝");
        call("write-1","call_mcp","cup",null);assertEquals(0,writes.get());
    }
    @Test void metadataWritesUseActualSessionEnvRatherThanDetachedSnapshot(){
        ResponseMetadataAccessor.put(session,"business_result","verified");
        assertEquals("verified",ResponseMetadataAccessor.snapshot(session).get("business_result"));
    }
}
