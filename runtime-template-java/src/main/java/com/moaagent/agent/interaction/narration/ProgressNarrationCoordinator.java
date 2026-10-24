/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction.narration;

import com.moaagent.agent.interaction.FrontendEventType;
import com.openjiuwen.core.session.AgentSessionApi;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * 请求级进度播放协调器。仅调度短小的事件写入，不等待业务、不修改规划或确认状态。
 * 每个 AgentSessionApi 实例独立管理；共享 conversationId 的不同请求不会共享定时任务。
 *
 * @since 0.1.0
 */
public final class ProgressNarrationCoordinator implements AutoCloseable {
    private static final Logger LOG = LoggerFactory.getLogger(ProgressNarrationCoordinator.class);
    private static final Scope SILENT = outcome -> { };

    private final ProgressNarrationProvider provider;
    private final NarrationSettings settings;
    private final StageLatencyProfileProvider latencyProfiles;
    private final ScheduledThreadPoolExecutor scheduler;
    private final Map<AgentSessionApi, Request> requests = Collections.synchronizedMap(new IdentityHashMap<>());
    private volatile boolean closed;

    /**
     * 创建共享的有界播放服务；关闭模式不创建调度线程。
     *
     * @param provider 快速返回快照的业务文案提供者
     * @param settings 资源上限配置
     */
    public ProgressNarrationCoordinator(ProgressNarrationProvider provider, NarrationSettings settings) {
        this(provider, settings, context -> Optional.empty());
    }

    /**
     * 创建使用业务文案和阶段时延画像的进度协调器。
     *
     * @param provider 业务文案快照
     * @param settings 展示开关和资源上限
     * @param latencyProfiles 独立的真实阶段时延画像
     */
    public ProgressNarrationCoordinator(ProgressNarrationProvider provider, NarrationSettings settings,
            StageLatencyProfileProvider latencyProfiles) {
        this.latencyProfiles = java.util.Objects.requireNonNull(latencyProfiles);
        this.provider = java.util.Objects.requireNonNull(provider);
        this.settings = java.util.Objects.requireNonNull(settings);
        scheduler = settings.enabled() ? new ScheduledThreadPoolExecutor(2, task -> {
            Thread worker = new Thread(task, "moa-progress");
            worker.setDaemon(true);
            worker.setUncaughtExceptionHandler((thread, error) -> LOG.error(
                    "[MOA-PROGRESS] worker={} errorType={}", thread.getName(), error.getClass().getSimpleName()));
            return worker;
        }) : null;
        if (scheduler != null) {
            scheduler.setRemoveOnCancelPolicy(true);
        }
    }

    /**
     * 创建关闭模式协调器。
     *
     * @return 不创建线程、保持旧交互行为的关闭实例
     */
    public static ProgressNarrationCoordinator disabled() {
        return new ProgressNarrationCoordinator(context -> Optional.empty(),
                new NarrationSettings(false, 1, Duration.ofMinutes(5)));
    }

    /**
     * 判断是否启用统一进度模式。
     *
     * @return 当前是否选择统一进度模式；无匹配文案时也不回退展示内部推理
     */
    public boolean enabled() {
        return settings.enabled();
    }

    /**
     * 建立一次调用的展示范围；恢复请求使用新的请求标识。
     *
     * @param session 当前运行时会话实例
     */
    public void beginRequest(AgentSessionApi session) {
        beginRequest(session, NarrationOutput.sessionStream());
    }

    /**
     * 建立一次调用并绑定固定输出端。
     *
     * @param session 当前运行时会话
     * @param output 本次调用的展示输出端
     */
    public void beginRequest(AgentSessionApi session, NarrationOutput output) {
        java.util.Objects.requireNonNull(output);
        if (!enabled() || closed) {
            return;
        }
        synchronized (session) {
            endRequest(session, "replaced");
            request(session, true, output);
        }
    }

    /**
     * 在真实操作开始前安排异步提示，不等待提示开始或播完。
     *
     * @param session 当前请求会话
     * @param stage 真实执行阶段
     * @param attributes 基座提供的安全标识字段
     * @return 幂等关闭句柄；关闭后不会再发送本操作片段
     */
    public Scope start(AgentSessionApi session, NarrationStage stage, Map<String, String> attributes) {
        return start(session, stage, attributes, false);
    }

    /**
     * 只在同一请求中首次播报相同阶段和展示上下文。
     *
     * @param session 当前运行时会话
     * @param stage 真实执行阶段
     * @param attributes 展示属性
     * @return 本次播放的关闭句柄
     */
    public Scope startOnce(AgentSessionApi session, NarrationStage stage, Map<String, String> attributes) {
        return start(session, stage, attributes, true);
    }

    /**
     * 播放真实动作入口的短提示。
     *
     * @param session 当前运行时会话
     * @param stage 真实执行阶段
     * @param attributes 展示属性
     */
    public void announce(AgentSessionApi session, NarrationStage stage, Map<String, String> attributes) {
        startOnce(session, stage, attributes).close();
    }

    private Scope start(AgentSessionApi session, NarrationStage stage, Map<String, String> attributes, boolean once) {
        if (!enabled() || closed) {
            return SILENT;
        }
        synchronized (session) {
            Optional<Request> requestResult = request(session, false, NarrationOutput.sessionStream());
            if (requestResult.isEmpty()) {
                return SILENT;
            }
            Request request = requestResult.get();
            PresentationKey key = new PresentationKey(stage, Map.copyOf(attributes));
            if (once && (request.presented.contains(key) || request.presented.size() >= 256)) {
                return SILENT;
            }
            NarrationContext context = new NarrationContext(request.id, UUID.randomUUID().toString(),
                    session.getSessionId(), stage, attributes);
            Optional<NarrationPlan> plan = resolvePlan(context);
            if (plan.isEmpty()) {
                discardIdle(request);
                return SILENT;
            }
            return schedulePlayback(request, context, plan.get(), key, once);
        }
    }

    private Optional<NarrationPlan> resolvePlan(NarrationContext context) {
        try {
            return Optional.ofNullable(provider.resolve(context)).orElseGet(Optional::empty);
        } catch (IllegalArgumentException | IllegalStateException exception) {
            unavailable(exception);
        } catch (RuntimeException exception) {
            unavailable(exception);
        }
        return Optional.empty();
    }

    private Scope schedulePlayback(Request request, NarrationContext context, NarrationPlan plan,
            PresentationKey key, boolean once) {
        if (request.active != null && request.active.plan.priority() > plan.priority()) {
            return SILENT;
        }
        Playback previous = request.active;
        Playback playback = new Playback(request, context, plan, latencyProfile(context));
        request.active = playback;
        if (previous != null) {
            previous.finish("superseded");
        }
        try {
            playback.expiry = scheduler.schedule(() -> playback.finish("budget_exhausted"),
                    plan.maxDuration().toMillis(), TimeUnit.MILLISECONDS);
            playback.tick = scheduler.schedule(playback::sendNext, 0, TimeUnit.MILLISECONDS);
            if (once) {
                request.presented.add(key);
            }
            return playback;
        } catch (java.util.concurrent.RejectedExecutionException exception) {
            playback.finish("unavailable");
            unavailable(exception);
            return SILENT;
        }
    }

    /**
     * 包围同步业务调用；原样返回结果或传播异常，不将话术失败变成业务失败。
     *
     * @param session 当前请求会话
     * @param stage 真实执行阶段
     * @param attributes 安全标识
     * @param action 原业务动作
     * @param <T> 业务结果类型
     * @return 原业务结果
     */
    public <T> T call(AgentSessionApi session, NarrationStage stage, Map<String, String> attributes, Supplier<T> action) {
        Scope scope = start(session, stage, attributes);
        boolean completed = false;
        try {
            T result = action.get();
            completed = true;
            return result;
        } finally {
            scope.finish(completed ? "completed" : "failed");
        }
    }

    /**
     * 关闭当前阶段，例如模型结束、工具接管或交互中断。
     *
     * @param session 当前请求会话
     * @param outcome 已发生的生命周期原因
     */
    public void stop(AgentSessionApi session, String outcome) {
        synchronized (session) {
            Request request = requests.get(session);
            if (request != null && request.active != null) {
                request.active.finish(outcome);
            }
        }
    }

    /**
     * 释放请求全部播放资源；不会关闭业务流或撤销业务。
     *
     * @param session 当前请求会话
     * @param outcome 已发生的生命周期原因
     */
    public void endRequest(AgentSessionApi session, String outcome) {
        synchronized (session) {
            Request request = requests.remove(session);
            if (request != null) {
                if (request.active != null) {
                    request.active.finish(outcome);
                }
                request.expiry.cancel(false);
            }
        }
    }

    private Optional<Request> request(AgentSessionApi session, boolean managed, NarrationOutput output) {
        Request existing = requests.get(session);
        if (existing != null) {
            return Optional.of(existing);
        }
        synchronized (requests) {
            if (closed || requests.size() >= settings.maxRequests()) {
                return Optional.empty();
            }
            Request created = new Request(session, managed, output);
            requests.put(session, created);
            try {
                created.expiry = scheduler.schedule(() -> expire(created), settings.requestLifetime().toMillis(),
                        TimeUnit.MILLISECONDS);
                return Optional.of(created);
            } catch (java.util.concurrent.RejectedExecutionException exception) {
                requests.remove(session);
                return Optional.empty();
            }
        }
    }

    private void expire(Request request) {
        synchronized (request.session) {
            if (requests.get(request.session) == request) {
                endRequest(request.session, "request_expired");
            }
        }
    }

    private void discardIdle(Request request) {
        if (!request.managed && request.active == null && requests.get(request.session) == request) {
            requests.remove(request.session);
            request.expiry.cancel(false);
        }
    }

    private Optional<StageLatencyProfile> latencyProfile(NarrationContext context) {
        try {
            return Optional.ofNullable(latencyProfiles.resolve(context)).orElseGet(Optional::empty);
        } catch (IllegalArgumentException | IllegalStateException exception) {
            unavailable(exception);
        } catch (RuntimeException exception) {
            unavailable(exception);
        }
        return Optional.empty();
    }

    private static void unavailable(RuntimeException exception) {
        LOG.warn("[MOA-PROGRESS] action=unavailable errorType={}", exception.getClass().getSimpleName());
    }

    @Override
    public void close() {
        closed = true;
        ArrayList<AgentSessionApi> sessions;
        synchronized (requests) {
            sessions = new ArrayList<>(requests.keySet());
        }
        sessions.forEach(session -> endRequest(session, "shutdown"));
        if (scheduler != null) {
            scheduler.shutdownNow();
        }
    }

    /**
     * 仅关闭展示的操作句柄，不阻塞业务等待播放结束。
     *
     * @since 0.1.0
     */
    public interface Scope extends AutoCloseable {
        /**
         * 结束当前展示操作并按生命周期原因处理剩余文本。
         *
         * @param outcome 已发生的结束原因
         */
        void finish(String outcome);

        @Override
        default void close() {
            finish("completed");
        }
    }

    private record PresentationKey(NarrationStage stage, Map<String, String> attributes) { }

    private static final class Request {
        private final AgentSessionApi session;
        private final boolean managed;
        private final NarrationOutput output;
        private final String id = UUID.randomUUID().toString();
        private ScheduledFuture<?> expiry;
        private Playback active;
        private final java.util.Set<PresentationKey> presented = new java.util.HashSet<>();

        private Request(AgentSessionApi session, boolean managed, NarrationOutput output) {
            this.session = session;
            this.managed = managed;
            this.output = output;
        }
    }

    private final class Playback implements Scope {
        private final Request request;
        private final NarrationContext context;
        private final NarrationPlan plan;
        private final Optional<StageLatencyProfile> latency;
        private final long started = System.nanoTime();
        private ScheduledFuture<?> tick;
        private ScheduledFuture<?> expiry;
        private int index;
        private int sequence;
        private boolean finished;

        private Playback(Request request, NarrationContext context, NarrationPlan plan,
                Optional<StageLatencyProfile> latency) {
            this.latency = latency;
            this.request = request;
            this.context = context;
            this.plan = plan;
        }

        private void sendNext() {
            synchronized (request.session) {
                if (finished || closed) {
                    return;
                }
                try {
                    emit(FrontendEventType.THINK_CHUNK, plan.segments().get(index++), "");
                    if (index < plan.segments().size()) {
                        tick = scheduler.schedule(this::sendNext, nextDelayMillis(), TimeUnit.MILLISECONDS);
                    }
                } catch (IllegalArgumentException | IllegalStateException exception) {
                    failedWrite(exception);
                } catch (RuntimeException exception) {
                    failedWrite(exception);
                }
            }
        }

        private long nextDelayMillis() {
            long expected = latency.map(profile -> profile.expectedDuration().toMillis()).orElse(1000L);
            int previous = 0;
            for (int boundary : plan.sentenceEnds()) {
                if (index < boundary) {
                    return Math.max(30, Math.min(250, expected / Math.max(1, boundary - previous - 1)));
                }
                if (index == boundary) {
                    long elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
                    long threshold = latency.map(profile -> profile.continuationAfter().toMillis()).orElse(1500L);
                    return previous == 0 ? Math.max(500, threshold - elapsed) : Math.max(500, expected);
                }
                previous = boundary;
            }
            return 0;
        }

        private int currentSentenceEnd() {
            for (int boundary : plan.sentenceEnds()) {
                if (index <= boundary) {
                    return boundary;
                }
            }
            return plan.segments().size();
        }

        private void failedWrite(RuntimeException exception) {
            unavailable(exception);
            finish("output_unavailable");
        }

        @Override
        public void finish(String outcome) {
            synchronized (request.session) {
                if (finished) {
                    return;
                }
                finished = true;
                cancelTasks();
                if (request.active == this) {
                    request.active = null;
                }
                try {
                    completeCurrentSentence(outcome);
                } catch (IllegalArgumentException | IllegalStateException exception) {
                    unavailable(exception);
                } catch (RuntimeException exception) {
                    unavailable(exception);
                } finally {
                    emitEnd(outcome);
                    discardIdle(request);
                }
            }
        }

        private void cancelTasks() {
            if (tick != null) {
                tick.cancel(false);
            }
            if (expiry != null) {
                expiry.cancel(false);
            }
        }

        private void completeCurrentSentence(String outcome) {
            int boundary = currentSentenceEnd();
            boolean writable = !java.util.Set.of("output_unavailable", "shutdown").contains(outcome);
            if (writable && (index > 0 || completesText(outcome)) && index < boundary) {
                String remaining = String.join("", plan.segments().subList(index, boundary));
                index = boundary;
                emit(FrontendEventType.THINK_CHUNK, remaining, "");
            }
        }

        private void emitEnd(String outcome) {
            if (index == 0) {
                return;
            }
            try {
                emit(FrontendEventType.THINK_END, "", outcome);
            } catch (IllegalArgumentException | IllegalStateException exception) {
                unavailable(exception);
            } catch (RuntimeException exception) {
                unavailable(exception);
            }
        }

        private boolean completesText(String outcome) {
            return switch (outcome) {
                case "completed", "request_finished", "tool_handoff", "budget_exhausted" -> true;
                default -> false;
            };
        }

        private void emit(FrontendEventType event, String content, String outcome) {
            sequence++;
            request.output.emit(request.session, event, Map.of("content", content));
        }
    }
}
