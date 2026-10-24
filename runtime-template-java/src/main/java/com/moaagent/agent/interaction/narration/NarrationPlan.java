/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction.narration;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * 业务声明的完整句子快照。传输分片与句子边界由框架生成，不作为业务配置入口。
 *
 * @since 0.1.0
 */
public final class NarrationPlan {
    private final List<String> sentences;
    private final Duration maxDuration;
    private final int priority;
    private final List<String> segmentParts;
    private final List<Integer> sentenceEnds;

    private NarrationPlan(List<String> sentences, Duration maxDuration, int priority) {
        if (sentences == null || sentences.isEmpty() || sentences.size() > 16
                || sentences.stream().anyMatch(text -> text == null || text.isBlank())
                || sentences.stream().mapToInt(String::length).sum() > 4096) {
            throw new IllegalArgumentException("话术需要1至16句非空文本，总长度不超过4096");
        }
        if (maxDuration == null || maxDuration.toMillis() < 1
                || maxDuration.compareTo(Duration.ofMinutes(2)) > 0) {
            throw new IllegalArgumentException("进度话术展示预算必须大于0且不超过2分钟");
        }
        this.sentences = List.copyOf(sentences);
        this.maxDuration = maxDuration;
        this.priority = priority;
        List<String> parts = new ArrayList<>();
        List<Integer> boundaries = new ArrayList<>();
        for (String sentence : sentences) {
            StringBuilder chunk = new StringBuilder();
            int codePoints = 0;
            for (int offset = 0; offset < sentence.length();) {
                int value = sentence.codePointAt(offset);
                chunk.appendCodePoint(value);
                offset += Character.charCount(value);
                if (++codePoints >= 2 && !chunk.toString().isBlank() && offset < sentence.length()
                        && !sentence.substring(offset).isBlank()) {
                    parts.add(chunk.toString());
                    chunk.setLength(0);
                    codePoints = 0;
                }
            }
            if (!chunk.isEmpty()) {
                parts.add(chunk.toString());
            }
            boundaries.add(parts.size());
        }
        this.segmentParts = List.copyOf(parts);
        this.sentenceEnds = List.copyOf(boundaries);
    }

    /**
     * 从完整句子创建播放计划；框架按 Unicode 码点生成传输增量，不拆开代理对。
     *
     * @param sentences 首句和可选的长尾等待续接句
     * @param maxDuration 展示预算，不改变业务超时
     * @param priority 请求内展示优先级
     * @return 与阶段时延画像独立的业务内容快照
     */
    public static NarrationPlan sentences(List<String> sentences, Duration maxDuration, int priority) {
        return new NarrationPlan(sentences, maxDuration, priority);
    }

    /**
     * 返回业务声明的完整句子。
     *
     * @return 不可变的完整句子列表
     */
    public List<String> sentences() {
        return sentences;
    }

    /**
     * 返回本次展示的最长持续时间。
     *
     * @return 展示预算
     */
    public Duration maxDuration() {
        return maxDuration;
    }

    /**
     * 返回请求内展示优先级。
     *
     * @return 请求内展示优先级
     */
    public int priority() {
        return priority;
    }

    List<String> segments() {
        return segmentParts;
    }

    List<Integer> sentenceEnds() {
        return sentenceEnds;
    }
}
