package local.agentbuilder.bridge;

import com.openjiuwen.core.foundation.llm.Model;
import com.openjiuwen.core.foundation.llm.ModelInvokeOptions;
import com.openjiuwen.core.foundation.llm.schema.AssistantMessage;
import com.openjiuwen.core.foundation.llm.schema.UserMessage;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SessionModelTest {
    @Test void cancellationCompletesOnlyTheOwningWaitAndDoesNotExposeSessionToProvider() throws Exception {
        var executions = new SessionExecutions(); executions.enter("first"); executions.enter("second");
        var count = new AtomicInteger(); var headers = new AtomicReference<Map<String,String>>();
        var pending = new CompletableFuture<AssistantMessage>(); var firstEntered = new CountDownLatch(1); var secondEntered = new CountDownLatch(1);
        var model = new SessionModel(new Model((messages, config, client, options) -> {
            int n = count.incrementAndGet(); headers.set(options.getRequestHeaders());
            if (n == 1) firstEntered.countDown(); else secondEntered.countDown(); return pending;
        }), executions);
        var first = model.invoke(List.of(new UserMessage("first")), ModelInvokeOptions.builder()
                .requestHeaders(Map.of(SessionModel.SESSION_HEADER, "first", "X-Trace", "kept")).build()).toCompletableFuture();
        assertTrue(firstEntered.await(2, TimeUnit.SECONDS)); assertEquals(Map.of("X-Trace", "kept"), headers.get());
        var second = model.invoke(List.of(new UserMessage("second")), ModelInvokeOptions.builder()
                .requestHeaders(Map.of(SessionModel.SESSION_HEADER, "second")).build()).toCompletableFuture();
        assertTrue(secondEntered.await(2, TimeUnit.SECONDS)); assertEquals("cancelling", executions.cancel("first"));
        assertTrue(first.isCompletedExceptionally()); assertFalse(second.isDone());
        assertThrows(CompletionException.class, first::join);
        executions.leave("first"); assertEquals("cancelled", executions.cancel("first"));
        assertThrows(IllegalStateException.class, () -> model.invoke(List.of(new UserMessage("late")), ModelInvokeOptions.builder()
                .requestHeaders(Map.of(SessionModel.SESSION_HEADER, "first")).build()));
        assertEquals(2, count.get());
        pending.complete(AssistantMessage.builder().content("late response").build());
        assertEquals("late response", second.join().getContent()); assertTrue(first.isCompletedExceptionally());
    }
    @Test void aSynchronousProviderCannotBlockCancellationOrOtherSessions() throws Exception {
        var executions = new SessionExecutions(); executions.enter("blocked");
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        var model = new SessionModel(new Model((messages, config, client, options) -> {
            entered.countDown();
            try { release.await(); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            return CompletableFuture.completedFuture(new AssistantMessage("late"));
        }), executions);
        var returned = CompletableFuture.supplyAsync(() -> model.invoke(List.of(new UserMessage("wait")),
                ModelInvokeOptions.builder().requestHeaders(Map.of(SessionModel.SESSION_HEADER,"blocked")).build()).toCompletableFuture());
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            var wait = returned.get(2, TimeUnit.SECONDS);
            assertEquals("cancelling", executions.cancel("blocked"));
            assertTrue(wait.isCompletedExceptionally());
            executions.enter("other"); executions.leave("blocked");
            assertEquals("cancelled", executions.cancel("blocked"));
        } finally { release.countDown(); }
    }
}
