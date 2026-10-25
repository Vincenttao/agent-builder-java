package com.openjiuwen.workbench.deep;
import java.net.URI;
import java.util.Map;
/** External model configuration, shared by application routing and Skill execution. */
public record ModelConfiguration(String apiKey,String baseUrl,String model) {
 public static ModelConfiguration from(Map<String,String> env){
  String key=pick(env,"MODEL_API_KEY","DEEPSEEK_API_KEY","");if(key.isBlank())throw new IllegalArgumentException("MODEL_API_KEY required");
  String base=pick(env,"MODEL_BASE_URL","DEEPSEEK_BASE_URL","https://api.deepseek.com").replaceAll("/+$","");
  URI uri=URI.create(base);if(!java.util.Set.of("http","https").contains(uri.getScheme())||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null)throw new IllegalArgumentException("INVALID_MODEL_BASE_URL");
  if(uri.getPath()==null||uri.getPath().isEmpty())base+="/v1";
  return new ModelConfiguration(key,base,pick(env,"MODEL_NAME","DEEPSEEK_MODEL","deepseek-flash"));
 }
 private static String pick(Map<String,String> env,String name,String legacy,String fallback){return env.getOrDefault(name,env.getOrDefault(legacy,fallback));}
 @Override public String toString(){return "ModelConfiguration[credentials=redacted, model="+model+"]";}
}
