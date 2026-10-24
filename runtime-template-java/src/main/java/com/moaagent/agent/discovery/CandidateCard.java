/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.discovery;

import java.util.List;
import java.util.Map;

/**
 * 描述可执行能力的标识、业务语义、路由、风险、资源和结构化输出约定。
 *
 * @since 0.1.0
 */
public record CandidateCard(String id, String name, String description, List<String> utterances,
        List<String> keywords, String adapter, String intent, Risk risk, Resource resource, Kind kind,
        Map<String, ResultField> outputs, HandoffSpec handoff) {

    public CandidateCard(String id, String name, String description, List<String> utterances,
            List<String> keywords, String adapter, String intent, Risk risk, Resource resource, Kind kind,
            Map<String, ResultField> outputs) {
        this(id, name, description, utterances, keywords, adapter, intent, risk, resource, kind, outputs,
                HandoffSpec.target());
    }

    /**
     * 区分智能体、工作流、Skill 和工具候选。
     *
     * @since 0.1.0
     */
    public enum Kind {
        AGENT,
        WORKFLOW,
        SKILL,
        TOOL
    }

    public CandidateCard(String id, String name, String description, List<String> utterances,
            List<String> keywords, String adapter, String intent, Risk risk, Resource resource, Kind kind) {
        this(id, name, description, utterances, keywords, adapter, intent, risk, resource, kind, Map.of());
    }

    /**
     * 根据适配器和细化意图生成稳定的候选标识。
     *
     * @param adapter 目标服务适配器名称
     * @param intent 目标工作流细化意图
     * @return 根据适配器和细化意图生成稳定的候选标识
     */
    public static String dynamicId(String adapter, String intent) {
        String identity = adapter.length() + ":" + adapter + intent;
        return "cap.dynamic." + java.util.UUID.nameUUIDFromBytes(identity.getBytes(java.nio.charset
                .StandardCharsets.UTF_8));
    }

    public CandidateCard(String id, String name, String description, List<String> utterances,
            List<String> keywords, String adapter, String intent, Risk risk, Resource resource) {
        this(id, name, description, utterances, keywords, adapter, intent, risk, resource, Kind.AGENT);
    }

    /**
     * 表示候选业务的执行风险等级。
     *
     * @since 0.1.0
     */
    public enum Risk {
        LOW,
        HIGH
    }

    public record Resource(String url, String sha256) {
    }

    private static boolean missing(String value) {
        return value == null || value.isBlank();
    }

    public CandidateCard {
        kind = kind == null ? Kind.AGENT : kind;
        handoff = handoff == null ? HandoffSpec.target() : handoff;
        if (kind != Kind.AGENT && handoff.mode() != HandoffSpec.Mode.TARGET) {
            throw new IllegalArgumentException("仅 Agent 候选支持领域选择或组合规划交接");
        }
        if (missing(id) || missing(name) || missing(adapter) || missing(intent) || risk == null) {
            throw new IllegalArgumentException("候选缺少 id/name/adapter/intent/risk");
        }
        utterances = List.copyOf(utterances);
        keywords = List.copyOf(keywords);
        outputs = outputs == null ? Map.of() : Map.copyOf(outputs);
        if (outputs.keySet().stream().anyMatch(key -> !key.matches("[A-Za-z][A-Za-z0-9_]{0,63}"))) {
            throw new IllegalArgumentException("结果字段名称必须为稳定 ASCII 标识");
        }
        if (resource != null && (resource.url() == null || resource.url().isBlank()
                || resource.sha256() == null || !resource.sha256().matches("[a-fA-F0-9]{64}"))) {
            throw new IllegalArgumentException("资源必须指定 URL 和 SHA-256");
        }
    }
}
