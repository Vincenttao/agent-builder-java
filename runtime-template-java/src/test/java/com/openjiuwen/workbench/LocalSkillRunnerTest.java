package com.openjiuwen.workbench;

import com.openjiuwen.workbench.runtime.LocalSkillRunner;
import org.junit.jupiter.api.Test;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

class LocalSkillRunnerTest {
    @Test void approvedAssetReceivesStructuredInputButNoParentCredentials() {
        String source="import os,json\nx=json.loads(os.environ['SKILL_INPUT'])\nprint(json.dumps({'success': True,'data': {'n': x['arguments']['n'], 'keyPresent': 'DEEPSEEK_API_KEY' in os.environ, 'env': sorted(os.environ)}}))";
        var runner=new LocalSkillRunner(Set.of(source),Duration.ofSeconds(3),8192);
        var result=runner.run(null,source,Map.of("arguments",Map.of("n",42)));
        assertEquals(true,result.get("success"));
        var data=(Map<?,?>)result.get("data");assertEquals(42,data.get("n"));assertEquals(false,data.get("keyPresent"));
        assertFalse(data.get("env").toString().contains("HOME"));
        assertFalse(data.get("env").toString().contains("PATH"));
    }
    @Test void refusesUnregisteredSourceBeforeExecution() {
        var runner=new LocalSkillRunner(Set.of("print('{}')"),Duration.ofSeconds(1),4096);
        assertThrows(IllegalArgumentException.class,()->runner.run(null,"raise Exception('unregistered')",Map.of()));
    }
    @Test void timeoutIsBoundedAndOutputDoesNotLeakIntoErrors() {
        String source="import time\ntime.sleep(20)";
        var runner=new LocalSkillRunner(Set.of(source),Duration.ofMillis(150),4096);
        assertTimeoutPreemptively(Duration.ofSeconds(4),()->assertEquals("SKILL_TIMEOUT",assertThrows(IllegalStateException.class,()->runner.run(null,source,Map.of())).getMessage()));
    }
    @Test void rejectsOversizedOrMalformedOutputAndNonzeroExit() {
        for(String source: Set.of("print('x'*9000)","print('not-json')","print('{}');print('{}')","raise Exception('sensitive payload')")){
            var runner=new LocalSkillRunner(Set.of(source),Duration.ofSeconds(2),4096);
            var failure=assertThrows(IllegalStateException.class,()->runner.run(null,source,Map.of()));
            assertFalse(failure.getMessage().contains("sensitive"));
        }
    }
}
