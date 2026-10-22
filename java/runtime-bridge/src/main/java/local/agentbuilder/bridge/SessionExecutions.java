package local.agentbuilder.bridge;

import java.util.HashMap;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.function.Supplier;

/** Cooperative cancellation: completion is confirmed only after the native invocation has returned. */
public final class SessionExecutions {
    private static final class Entry {
        boolean active; boolean cancelled;
        final Set<CompletableFuture<?>> waits = new HashSet<>();
        final Set<Thread> providers = new HashSet<>();
    }
    private final Map<String, Entry> entries = new HashMap<>();
    private Entry entry(String id) {
        if (id == null || id.isBlank() || id.length() > 200) throw new IllegalArgumentException("INVALID_SESSION_ID");
        if (!entries.containsKey(id) && entries.size() >= 10000) throw new IllegalStateException("SESSION_LIMIT");
        return entries.computeIfAbsent(id, ignored -> new Entry());
    }
    public synchronized void enter(String id) {
        Entry entry = entry(id);
        if (entry.cancelled) throw new IllegalStateException("RUN_CANCELLED");
        if (entry.active) throw new IllegalStateException("SESSION_BUSY");
        entry.active = true;
    }
    public synchronized void leave(String id) { entry(id).active = false; }
    public String cancel(String id) {
        Set<CompletableFuture<?>> waits; Set<Thread> providers;
        synchronized (this) {
            Entry entry = entry(id); entry.cancelled = true;
            waits = Set.copyOf(entry.waits); providers = Set.copyOf(entry.providers);
        }
        // Complete only the owned native wait. The provider HTTP request may finish later;
        // its completion cannot resume this agent or any tools after the cancellation.
        waits.forEach(wait -> wait.completeExceptionally(new IllegalStateException("RUN_CANCELLED")));
        providers.forEach(Thread::interrupt);
        synchronized (this) { return entry(id).active ? "cancelling" : "cancelled"; }
    }
    public <T> CompletionStage<T> modelCall(String id, Supplier<CompletionStage<T>> invoke) {
        CompletableFuture<T> wait = new CompletableFuture<>(); Thread provider;
        synchronized (this) {
            Entry entry = entry(id);
            if (entry.cancelled) throw new IllegalStateException("RUN_CANCELLED");
            entry.waits.add(wait);
            wait.whenComplete((value, error) -> { synchronized (this) { entry.waits.remove(wait); } });
            provider = Thread.ofVirtual().name("builder-model").unstarted(() -> {
                try {
                    if (isCancelled(id)) { wait.completeExceptionally(new IllegalStateException("RUN_CANCELLED")); return; }
                    // The pinned SDK invokes HTTP synchronously before returning its stage.
                    // No registry lock may be held while provider code runs.
                    invoke.get().whenComplete((value, error) -> {
                        if (error == null) wait.complete(value); else wait.completeExceptionally(error);
                    });
                } catch (RuntimeException error) { wait.completeExceptionally(error); }
                finally { synchronized (this) { entry.providers.remove(Thread.currentThread()); } }
            });
            entry.providers.add(provider);
        }
        provider.start();
        return wait;
    }
    public synchronized boolean isCancelled(String id) {
        Entry entry = entries.get(id);
        return entry != null && entry.cancelled;
    }
}
