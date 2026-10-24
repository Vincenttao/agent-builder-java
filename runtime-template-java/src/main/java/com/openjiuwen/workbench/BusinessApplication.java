package com.openjiuwen.workbench;

import com.openjiuwen.workbench.runtime.*;
import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.schema.*;
import com.openjiuwen.core.session.tracer.TracerHandlerRegistry;
import com.openjiuwen.extensions.tracerotel.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import java.nio.file.*;
import java.util.*;

/** Local single-process business application; assets are external to the executable JAR. */
@SpringBootApplication
public class BusinessApplication {
    public static void main(String[] args){
        var app=new SpringApplication(BusinessApplication.class);
        app.setDefaultProperties(Map.of("server.address","127.0.0.1","server.port","8780","spring.application.name","moa-business-application","openjiuwen.service.security.enabled","false"));
        app.run(args);
    }
    @Bean BusinessAssets businessAssets(){return new BusinessAssets(Path.of(System.getenv().getOrDefault("WORKBENCH_APP_DIR",".")));}
    @Bean Model businessModel(){
        String key=System.getenv("DEEPSEEK_API_KEY");if(key==null||key.isBlank())throw new IllegalArgumentException("DEEPSEEK_API_KEY required");
        var client=new ModelClientConfig();client.setClientProvider("OpenAI");client.setApiKey(key);String base=System.getenv().getOrDefault("DEEPSEEK_BASE_URL","https://api.deepseek.com").replaceAll("/+$","");client.setApiBase(base.endsWith("/v1")?base:base+"/v1");client.setTimeout(45.0);client.setMaxRetries(0);
        var request=ModelRequestConfig.builder().modelName("deepseek-flash").maxTokens(4096).build();request.setExtraField("thinking",Map.of("type","disabled"));
        return new Model(client,request);
    }
    @Bean BusinessHost businessHost(BusinessAssets assets,Model model){
        var config=OtelTracerConfig.builder().exporterType("otlp").protocol("http").exporterEndpoint(System.getenv().getOrDefault("OTEL_EXPORTER_OTLP_ENDPOINT","http://127.0.0.1:14318")).serviceName("moa-business-application").isRedactionEnabled(true).scheduleDelayMillis(100).build();
        var tracer=OtelTracerSetup.initOtelTracer(config);TracerHandlerRegistry.registerHandler("workbench_otel",new OtelAgentHandler(tracer,config));
        return new BusinessHost(assets,model,model,Path.of(System.getenv().getOrDefault("WORKBENCH_STATE_DIR",".runtime-state")),tracer);
    }
    @Bean(destroyMethod="close") AutoCloseable telemetryShutdown(){return ()->{OtelTracerSetup.forceFlushOtelTracer();TracerHandlerRegistry.unregisterHandler("workbench_otel");OtelTracerSetup.shutdownOtelTracer();};}
    @RestController
    static class ExecutionController {
        private final BusinessHost service;private final BusinessAssets assets;
        ExecutionController(BusinessHost service,BusinessAssets assets){this.service=service;this.assets=assets;}
        record Message(String conversationId,String query){}
        record Reply(String taskId,String token,String answer){}
        record Decision(String requestId,String choice){}
        record TaskInput(String taskId){}
        @GetMapping("/workbench/application") Map<String,Object> application(){return Map.of("definition",assets.definition(),"mode","live-java","runId",System.getProperty("workbench.runId","standalone"),"recovery","same-process, two tasks; restart interrupts unfinished conversations");}
        @PostMapping("/workbench/conversations") BusinessHost.View reserve(){return service.reserve();}
        @PostMapping("/workbench/messages") BusinessHost.View message(@RequestBody Message input){return service.message(input.conversationId,input.query);}
        @GetMapping("/workbench/conversations/{id}") BusinessHost.View view(@PathVariable String id){return service.view(id);}
        @PostMapping("/workbench/conversations/{id}/reply") BusinessHost.View reply(@PathVariable String id,@RequestBody Reply input){return service.reply(id,input.taskId,input.token,input.answer);}
        @PostMapping("/workbench/conversations/{id}/decide") BusinessHost.View decide(@PathVariable String id,@RequestBody Decision input){return service.decide(id,input.requestId,input.choice);}
        @PostMapping("/workbench/conversations/{id}/resume") BusinessHost.View resume(@PathVariable String id,@RequestBody TaskInput input){return service.resume(id,input.taskId);}
        @PostMapping("/workbench/conversations/{id}/receipt") BusinessHost.View receipt(@PathVariable String id,@RequestBody TaskInput input){return service.receipt(id,input.taskId);}
        @ExceptionHandler({IllegalArgumentException.class,IllegalStateException.class}) ResponseEntity<Map<String,Object>> error(RuntimeException error){String message=error.getMessage();String code=message!=null&&message.matches("[A-Z][A-Z0-9_]{1,100}")?message:"EXECUTION_FAILED";return ResponseEntity.badRequest().body(Map.of("error",code));}
    }
}
