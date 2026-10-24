package com.openjiuwen.workbench.runtime;

import com.fasterxml.jackson.core.type.TypeReference;
import com.moaagent.agent.skill.SkillScriptRunner;
import com.moaagent.agent.support.Json;
import com.openjiuwen.core.session.AgentSessionApi;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.*;

/** Limited trusted-local Python adapter; this is not a security sandbox or a generic command tool. */
public final class LocalSkillRunner implements SkillScriptRunner {
    private final Set<String> registered;
    private final Duration timeout;
    private final int maxOutput;

    public LocalSkillRunner(Set<String> registered, Duration timeout, int maxOutput) {
        if(timeout.isNegative() || timeout.isZero() || timeout.compareTo(Duration.ofSeconds(30))>0
                || maxOutput<1024 || maxOutput>262144) throw new IllegalArgumentException("Invalid script limits");
        this.registered=Set.copyOf(registered);this.timeout=timeout;this.maxOutput=maxOutput;
    }

    @Override public Map<String,Object> run(AgentSessionApi session,String source,Map<String,Object> input) {
        if(!registered.contains(source)) throw new IllegalArgumentException("UNREGISTERED_SKILL_SCRIPT");
        String payload=Json.write(input);
        if(payload.getBytes(StandardCharsets.UTF_8).length>65536) throw new IllegalArgumentException("SKILL_INPUT_TOO_LARGE");
        Path working=null;Process child=null;
        ExecutorService readers=Executors.newFixedThreadPool(2,r->{var t=new Thread(r,"skill-output");t.setDaemon(true);return t;});
        try {
            working=Files.createTempDirectory("moa-local-skill-");
            // -I ignores user Python packages and PYTHON* variables. No model-generated command or shell is used.
            var builder=new ProcessBuilder("/usr/bin/python3","-I","-c",source).directory(working.toFile());
            builder.environment().clear();builder.environment().put("SKILL_INPUT",payload);
            builder.environment().put("LANG","C.UTF-8");
            child=builder.start();child.getOutputStream().close();
            final Process process=child;
            Future<byte[]> stdout=readers.submit(()->boundedRead(process.getInputStream(),maxOutput));
            Future<byte[]> stderr=readers.submit(()->boundedRead(process.getErrorStream(),4096));
            if(!child.waitFor(timeout.toMillis(),TimeUnit.MILLISECONDS)) throw new IllegalStateException("SKILL_TIMEOUT");
            byte[] output=stdout.get(1,TimeUnit.SECONDS);stderr.get(1,TimeUnit.SECONDS);
            if(child.exitValue()!=0) throw new IllegalStateException("SKILL_PROCESS_FAILED");
            // Fail on trailing JSON or non-object output; Json.object's forgiving fallback is not appropriate here.
            var mapper=Json.MAPPER.readerFor(new TypeReference<Map<String,Object>>(){}).with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
            Map<String,Object> result=mapper.readValue(output);
            if(result==null) throw new IllegalStateException("SKILL_INVALID_OUTPUT");
            return result;
        } catch(IllegalStateException e) {throw e;
        } catch(InterruptedException e) {Thread.currentThread().interrupt();throw new IllegalStateException("SKILL_CANCELLED");
        } catch(Exception e) {throw new IllegalStateException("SKILL_INVALID_OUTPUT");
        } finally {
            if(child!=null){child.descendants().forEach(ProcessHandle::destroyForcibly);if(child.isAlive())child.destroyForcibly();}
            readers.shutdownNow();
            if(working!=null)try(var paths=Files.walk(working)){for(Path path:paths.sorted(java.util.Comparator.reverseOrder()).toList())Files.deleteIfExists(path);}catch(Exception ignored){}
        }
    }
    private static byte[] boundedRead(InputStream input,int max) throws Exception {
        try(input){byte[] bytes=input.readNBytes(max+1);if(bytes.length>max)throw new IllegalStateException("SKILL_OUTPUT_TOO_LARGE");return bytes;}
    }
}
