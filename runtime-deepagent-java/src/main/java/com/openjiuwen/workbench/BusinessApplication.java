package com.openjiuwen.workbench;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.openjiuwen.workbench.deep.*;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import java.nio.file.*;
import java.util.*;
@SpringBootApplication
public class BusinessApplication {
 public static void main(String[] args){var app=new SpringApplication(BusinessApplication.class);app.setDefaultProperties(Map.of("server.address","127.0.0.1","server.port","8780","spring.application.name","deepagent-business-application","openjiuwen.service.security.enabled","false"));app.run(args);}
 @Bean(destroyMethod="close") DeepHost deepHost() throws Exception {Path app=Path.of(System.getenv().getOrDefault("WORKBENCH_APP_DIR",".")).toAbsolutePath().normalize(),state=Path.of(System.getenv().getOrDefault("WORKBENCH_STATE_DIR",".runtime-state")).toAbsolutePath().normalize();var definition=new ObjectMapper().readValue(Files.readString(app.resolve("application.json")),new TypeReference<Map<String,Object>>(){});String prompt=Files.readString(app.resolve("instructions.md"))+"\n当前应用业务范围（超出时请说明不能处理，不执行其他业务）："+new ObjectMapper().writeValueAsString(definition.get("scope"));var config=ModelConfiguration.from(System.getenv());var assembly=SkillAssembly.load(app);return new DeepHost(state.resolve("artifacts"),(id,tools)->DeepFactory.create(id,state.resolve("artifacts").resolve(id),prompt,config,tools,assembly.tools(tools)));}
 @RestController static class Controller {
  private final DeepHost host;Controller(DeepHost host){this.host=host;}
  record Message(String conversationId,String query){}
  @GetMapping("/workbench/application") Map<String,Object> application(){return Map.of("mode","live-java","family","deepagent","runId",System.getProperty("workbench.runId","standalone"));}
  @PostMapping("/workbench/conversations") Map<String,Object> reserve(){return host.reserve();}
  @PostMapping("/workbench/messages") Map<String,Object> message(@RequestBody Message input){return host.message(input.conversationId,input.query);}
  @GetMapping("/workbench/conversations/{id}") Map<String,Object> view(@PathVariable String id){return host.view(id);}
  @ExceptionHandler({IllegalArgumentException.class,IllegalStateException.class}) ResponseEntity<Map<String,Object>> error(RuntimeException e){String code=e.getMessage();return ResponseEntity.badRequest().body(Map.of("error",code!=null&&code.matches("[A-Z_]+")?code:"DEEP_EXECUTION_FAILED"));}
 }
}
