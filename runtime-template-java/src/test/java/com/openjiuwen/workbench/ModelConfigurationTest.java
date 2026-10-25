package com.openjiuwen.workbench;
import com.openjiuwen.workbench.runtime.ModelConfiguration;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class ModelConfigurationTest {
 @Test void alternateModelUsesItsConfiguredPrefixAndNeverPrintsCredentials(){var value=ModelConfiguration.from(Map.of("MODEL_API_KEY","local-placeholder","MODEL_BASE_URL","http://127.0.0.1:8999/compatible/v1/","MODEL_NAME","alternate-model"));assertEquals("alternate-model",value.model());assertEquals("http://127.0.0.1:8999/compatible/v1",value.baseUrl());assertFalse(value.toString().contains("local-placeholder"));}
 @Test void legacyVariablesAndDefaultsRemainCompatible(){var legacy=ModelConfiguration.from(Map.of("DEEPSEEK_API_KEY","local-placeholder","DEEPSEEK_MODEL","legacy-model"));assertEquals("legacy-model",legacy.model());assertEquals("https://api.deepseek.com/v1",legacy.baseUrl());assertEquals("deepseek-flash",ModelConfiguration.from(Map.of("MODEL_API_KEY","local-placeholder")).model());}
 @Test void genericVariablesWinAndInvalidEndpointsFailBeforeUse(){assertEquals("generic",ModelConfiguration.from(Map.of("MODEL_API_KEY","local-placeholder","MODEL_NAME","generic","DEEPSEEK_MODEL","legacy")).model());assertThrows(IllegalArgumentException.class,()->ModelConfiguration.from(Map.of("MODEL_API_KEY","local-placeholder","MODEL_BASE_URL","https://user:password@example.com/v1")));}
 @Test void configuredModelActuallyReachesOpenAiCompatibleRequest() throws Exception {
  var body=new java.util.concurrent.atomic.AtomicReference<Map<String,Object>>();
  var server=com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
  server.createContext("/",exchange->{body.set(com.moaagent.agent.support.Json.object(new String(exchange.getRequestBody().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8)));byte[] bytes="{\"id\":\"local-model-check\",\"object\":\"chat.completion\",\"model\":\"alternate-model\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"ok\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}".getBytes(java.nio.charset.StandardCharsets.UTF_8);exchange.getResponseHeaders().set("Content-Type","application/json");exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);exchange.close();});server.start();
  try {var model=BusinessApplication.createBusinessModel(Map.of("MODEL_API_KEY","local-placeholder","MODEL_NAME","alternate-model","MODEL_BASE_URL","http://127.0.0.1:"+server.getAddress().getPort()+"/compatible/v1"));model.invoke("local-only configuration test").toCompletableFuture().get(20,java.util.concurrent.TimeUnit.SECONDS);assertEquals("alternate-model",body.get().get("model"));assertFalse(body.get().containsKey("thinking"));assertEquals("alternate-model",model.getModelConfig().getModelName());}
  finally {server.stop(0);}
 }
}
