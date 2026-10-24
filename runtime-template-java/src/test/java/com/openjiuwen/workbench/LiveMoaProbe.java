package com.openjiuwen.workbench;

import com.moaagent.agent.skill.*;
import com.moaagent.agent.rail.MoaAgentRailProvider;
import com.moaagent.agent.routing.context.DefaultModelContextContributor;
import com.moaagent.agent.interaction.narration.NarrationOutput;
import com.moaagent.agent.interaction.narration.ProgressNarrationCoordinator;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.schema.ModelClientConfig;
import com.openjiuwen.core.foundation.llm.schema.ModelRequestConfig;
import com.openjiuwen.core.session.AgentSession;
import com.openjiuwen.core.session.tracer.TracerHandlerRegistry;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.AgentRail;
import com.openjiuwen.core.runner.Runner;
import com.openjiuwen.extensions.tracerotel.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Explicit opt-in live probe; it is not discovered as a unit test. */
public class LiveMoaProbe {
  public static void main(String[] args) throws Exception {
    boolean httpMode=args.length>1&&args[1].equals("http");
    String key=System.getenv("DEEPSEEK_API_KEY");if(key==null||key.isBlank())throw new IllegalStateException("DEEPSEEK_API_KEY missing");
    Path root=Path.of(args[0]).toAbsolutePath();Files.createDirectories(root.resolve("skills/entry"));
    Files.writeString(root.resolve("skills/entry/SKILL.md"),"---\nname: entry\ndescription: 查询员工积分余额\n---\n当前请求仅查询余额，直接调用 call_mcp，operation=balance，arguments={}。结果已由程序验证，不要请求确认，不要调用其他工具。\n");
    String script=httpMode?"import json,urllib.request\nwith urllib.request.urlopen("+Json.write(args[2]+"/api/employees/demo/balance")+",timeout=2) as r:\n d=json.load(r)\nvalue=d['employee']['wallet']['availablePoints']\nprint(json.dumps({'success':True,'data':{'available':value,'unit':'i豆'},'model_data':{'available':value,'unit':'i豆'}}))\n":"# trusted probe operation fixture\n";
    Files.writeString(root.resolve("skills/balance.py"),script);
    var client=new ModelClientConfig();client.setClientProvider("OpenAI");client.setApiKey(key);client.setApiBase("https://api.deepseek.com/v1");client.setTimeout(45.0);client.setMaxRetries(0);
    var request=ModelRequestConfig.builder().modelName("deepseek-flash").maxTokens(2048).build();request.setExtraField("thinking",Map.of("type","disabled"));
    var model=args.length>1&&args[1].equals("fixture")?new Model((messages,modelConfig,clientConfig,options)->java.util.concurrent.CompletableFuture.completedFuture(com.openjiuwen.core.foundation.llm.schema.AssistantMessage.builder().content("").toolCalls(List.of(com.openjiuwen.core.foundation.llm.schema.ToolCall.builder().id("fixed-read-call").name("call_mcp").arguments("{\"operation\":\"balance\",\"arguments\":{}}").build())).build())):new Model(client,request);
    var config=OtelTracerConfig.builder().exporterType("otlp").protocol("http").exporterEndpoint("http://127.0.0.1:14318").serviceName("workbench-moa-probe").isRedactionEnabled(true).scheduleDelayMillis(100).build();
    var tracer=OtelTracerSetup.initOtelTracer(config);TracerHandlerRegistry.registerHandler("workbench_otel",new OtelAgentHandler(tracer,config));
    Runner.start().toCompletableFuture().join();
    var modelCalls=new AtomicInteger();var toolCalls=new AtomicInteger();
    var empty=Map.<String,Object>of("type","object","properties",Map.of(),"required",List.of(),"additionalProperties",false);
    var output=Map.<String,Object>of("type","object","properties",Map.of("available",Map.of("type","integer"),"unit",Map.of("type","string")),"required",List.of("available","unit"),"additionalProperties",false);
    var operation=new SkillOperation(SkillOperation.Type.SCRIPT,"查询 i豆",null,null,null,null,"balance.py",empty,output,Map.of(),false,true,2,null,null,null,false,null,output,null);
    SkillScriptRunner local=new com.openjiuwen.workbench.runtime.LocalSkillRunner(Set.of(script),java.time.Duration.ofSeconds(3),65536);
    SkillScriptRunner fixture=(session,source,input)->{toolCalls.incrementAndGet();if(httpMode)return local.run(session,source,input);return Map.of("success",true,"data",Map.of("available",1280,"unit","i豆"),"model_data",Map.of("available",1280,"unit","i豆"));};
    AgentRail count=new AgentRail(){@Override public void beforeModelCall(AgentCallbackContext context){modelCalls.incrementAndGet();}};
    var callbackCounts=new java.util.concurrent.ConcurrentHashMap<String,Integer>();
    var traceId=new java.util.concurrent.atomic.AtomicReference<String>();
    OtelRail observed=new com.moaagent.compat.DeepSessionOtelRail(){
      @Override public void beforeInvoke(AgentCallbackContext c){callbackCounts.merge("beforeInvoke",1,Integer::sum);callbackCounts.put("handlersAtInvoke",TracerHandlerRegistry.getAgentHandlers().size());super.beforeInvoke(c);traceId.set(io.opentelemetry.api.trace.Span.current().getSpanContext().getTraceId());callbackCounts.put("spanCurrentValid",io.opentelemetry.api.trace.Span.current().getSpanContext().isValid()?1:0);}
      @Override public void afterInvoke(AgentCallbackContext c){callbackCounts.merge("afterInvoke",1,Integer::sum);super.afterInvoke(c);}
      @Override public void beforeModelCall(AgentCallbackContext c){callbackCounts.merge("beforeModel",1,Integer::sum);super.beforeModelCall(c);}
      @Override public void afterModelCall(AgentCallbackContext c){callbackCounts.merge("afterModel",1,Integer::sum);super.afterModelCall(c);}
    };
    var services=new NativeSkillAgent.ExecutionServices(fixture,ProgressNarrationCoordinator.disabled(),NarrationOutput.sessionStream(),List.of(),new DefaultModelContextContributor(),List.of(role->List.of(observed,count)));
    int exit=1;
    try(var agent=NativeSkillAgent.create(new NativeSkillAgent.Settings("probe-"+UUID.randomUUID(),root.resolve("agent").toString(),8),model,new SkillAssets(root.resolve("skills").toString(),"entry"),Map.of("balance",operation),services)){
      var session=new AgentSession("probe-session-"+UUID.randomUUID(),new LinkedHashMap<>(),null);
      var result=agent.invoke(Map.of("query","查询我的 i豆余额","conversation_id",session.getSessionId()),session);
      boolean passed=modelCalls.get()>0&&toolCalls.get()==1&&Json.write(result).contains("1280");
      var report=new LinkedHashMap<String,Object>();report.put("passed",passed);report.put("coreVersion","0.1.17");report.put("runtimeVersion","0.1.4");report.put("model","deepseek-flash");report.put("modelCalls",modelCalls.get());report.put("otelCallbacks",callbackCounts);report.put("fixtureModel",args.length>1&&args[1].equals("fixture"));report.put("verifiedToolCalls",toolCalls.get());report.put("result",result);report.put("traceId",traceId.get());report.put("businessHttp",httpMode);report.put("scope",httpMode?"real DeepSeek + MOA/Core + trusted local Skill adapter + independent HTTP Mock; query only":"real MOA NativeSkillAgent/Core model loop; business operation uses a declared fixture");
      Files.writeString(root.resolve("live-moa-probe.json"),Json.write(report));System.out.println("LIVE_MOA_PROBE "+Json.write(report));exit=passed?0:1;
    }finally{OtelTracerSetup.forceFlushOtelTracer();TracerHandlerRegistry.unregisterHandler("workbench_otel");Runner.stop().toCompletableFuture().join();OtelTracerSetup.shutdownOtelTracer();}
    System.exit(exit);
  }
}
