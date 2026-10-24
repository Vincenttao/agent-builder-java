/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.support.Json;
import com.openjiuwen.core.session.AgentSessionApi;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * 保存 Skill 执行的会话状态、结果版本、授权及幂等回执。
 *
 * @since 0.1.0
 */
public final class SkillSession {
    /**
     * Skill 会话快照的持久化键。
     */
    public static final String KEY = "__native_skill_execution__";

    private String executionId;

    private String parentId;

    private String query;

    /** 已绑定能力的可信展示名称，不来自用户输入或模型输出。 */
    private String taskDisplayName = "";

    private String state = "ACTIVE";

    /** 运行时保存每个已校验步骤结果时递增；内部步骤也占版本，不由模型生成。 */
    private int revision;

    private int resultPolicyVersion = 1;

    /** 各步骤处理后的 data，供运行时绑定和脚本使用；模型工具回执使用独立摘要。 */
    private Map<String, Object> results = new LinkedHashMap<>();

    /** 模型可调用 operation 的回执；nextOperation 链使用末步 revision，与各步骤的结果版本分别保存。 */
    private Map<String, Object> modelResults = new LinkedHashMap<>();

    /** 各步骤最近结果的 revision，供依赖血缘和过期检查；不是交易幂等键。 */
    private Map<String, Integer> resultVersions = new LinkedHashMap<>();

    private Map<String, Integer> calls = new LinkedHashMap<>();

    private Map<String, String> approvals = new LinkedHashMap<>();

    private Map<String, Object> pending = new LinkedHashMap<>();

    /** 按工具 callId 重放相同请求的回执；与业务依赖版本分开管理。 */
    private Map<String, Object> receipts = new LinkedHashMap<>();

    private Map<String, Object> outcome = new LinkedHashMap<>();

    private Map<String, Object> responseMetadata = Map.of();

    public Map<String, Object> getResponseMetadata() {
        return responseMetadata;
    }

    public void setResponseMetadata(Map<String, Object> value) {
        responseMetadata = com.moaagent.agent.leadout.ServiceLeadOutMetadata.project(value);
    }

    /**
     * 读取持久化的 Skill 会话状态。
     *
     * @param session 当前请求所属会话
     * @return 已持久化的会话状态，尚未初始化时为空
     */
    public static Optional<SkillSession> load(AgentSessionApi session) {
        Object value = session.getState(KEY);
        return Optional.ofNullable(value).map(stored -> {
            Map<String, Object> snapshot = Json.object(stored);
            SkillSession state = Json.MAPPER.convertValue(snapshot, SkillSession.class);
            if (!snapshot.containsKey("resultPolicyVersion")) {
                state.setResultPolicyVersion(0);
            }
            return state;
        });
    }

    /**
     * 校验状态大小并保存 Skill 会话快照。
     *
     * @param session 当前请求所属会话
     */
    public void save(AgentSessionApi session) {
        String snapshot = Json.write(this);
        if (snapshot.length() > 1_000_000) {
            throw new IllegalStateException("Skill 会话状态超限");
        }
        session.updateState(Map.of(KEY, snapshot));
    }

    /**
     * 返回Skill 执行实例标识。
     *
     * @return Skill 执行实例标识
     */
    public String getExecutionId() {
        return executionId;
    }

    /**
     * 设置Skill 执行实例标识。
     *
     * @param value Skill 执行实例标识
     */
    public void setExecutionId(String value) {
        executionId = value;
    }

    /**
     * 返回父规划中的任务标识。
     *
     * @return 父规划中的任务标识
     */
    public String getParentId() {
        return parentId;
    }

    /**
     * 设置父规划中的任务标识。
     *
     * @param value 父规划中的任务标识
     */
    public void setParentId(String value) {
        parentId = value;
    }

    /**
     * 返回当前任务的业务请求。
     *
     * @return 当前任务的业务请求
     */
    public String getQuery() {
        return query;
    }

    /**
     * 设置当前任务的业务请求。
     *
     * @param value 当前任务的业务请求
     */
    public void setQuery(String value) {
        query = value;
    }

    /**
     * 返回当前父任务的业务展示名称。
     *
     * @return 已绑定候选名称；旧快照可能为空
     */
    public String getTaskDisplayName() {
        return taskDisplayName;
    }

    /**
     * 设置当前父任务的业务展示名称。
     *
     * @param value 已绑定候选提供的名称
     */
    public void setTaskDisplayName(String value) {
        taskDisplayName = value == null ? "" : value;
    }

    /**
     * 返回Skill 执行状态。
     *
     * @return Skill 执行状态
     */
    public String getState() {
        return state;
    }

    /**
     * 设置Skill 执行状态。
     *
     * @param value Skill 执行状态
     */
    public void setState(String value) {
        state = value;
    }

    /**
     * 返回当前状态版本。
     *
     * @return 当前状态版本
     */
    public int getRevision() {
        return revision;
    }

    /**
     * 设置当前状态版本。
     *
     * @param value 当前状态版本
     */
    public void setRevision(int value) {
        revision = value;
    }

    public int getResultPolicyVersion() {
        return resultPolicyVersion;
    }

    public void setResultPolicyVersion(int value) {
        resultPolicyVersion = value;
    }

    /**
     * 返回按操作保存的已验证业务结果。
     *
     * @return 按操作保存的已验证业务结果
     */
    public Map<String, Object> getResults() {
        return results;
    }

    /**
     * 设置按操作保存的已验证业务结果。
     *
     * @param value 按操作保存的已验证业务结果
     */
    public void setResults(Map<String, Object> value) {
        results = value;
    }

    public Map<String, Object> getModelResults() {
        return modelResults;
    }

    public void setModelResults(Map<String, Object> value) {
        modelResults = value == null ? new LinkedHashMap<>() : value;
    }

    /**
     * 返回各业务结果的版本。
     *
     * @return 各业务结果的版本
     */
    public Map<String, Integer> getResultVersions() {
        return resultVersions;
    }

    /**
     * 设置各业务结果的版本。
     *
     * @param value 各业务结果的版本
     */
    public void setResultVersions(Map<String, Integer> value) {
        resultVersions = value;
    }

    /**
     * 返回各授权操作的已调用次数。
     *
     * @return 各授权操作的已调用次数
     */
    public Map<String, Integer> getCalls() {
        return calls;
    }

    /**
     * 设置各授权操作的已调用次数。
     *
     * @param value 各授权操作的已调用次数
     */
    public void setCalls(Map<String, Integer> value) {
        calls = value;
    }

    /**
     * 返回待消费的业务授权凭据。
     *
     * @return 待消费的业务授权凭据
     */
    public Map<String, String> getApprovals() {
        return approvals;
    }

    /**
     * 设置待消费的业务授权凭据。
     *
     * @param value 待消费的业务授权凭据
     */
    public void setApprovals(Map<String, String> value) {
        approvals = value;
    }

    /**
     * 返回当前等待交互的操作上下文。
     *
     * @return 当前等待交互的操作上下文
     */
    public Map<String, Object> getPending() {
        return pending;
    }

    /**
     * 设置当前等待交互的操作上下文。
     *
     * @param value 当前等待交互的操作上下文
     */
    public void setPending(Map<String, Object> value) {
        pending = value;
    }

    /**
     * 返回已验证的执行回执。
     *
     * @return 已验证的执行回执
     */
    public Map<String, Object> getReceipts() {
        return receipts;
    }

    /**
     * 设置已验证的执行回执。
     *
     * @param value 已验证的执行回执
     */
    public void setReceipts(Map<String, Object> value) {
        receipts = value;
    }

    /**
     * 返回Skill 最终协议结果。
     *
     * @return Skill 最终协议结果
     */
    public Map<String, Object> getOutcome() {
        return outcome;
    }

    /**
     * 设置Skill 最终协议结果。
     *
     * @param value Skill 最终协议结果
     */
    public void setOutcome(Map<String, Object> value) {
        outcome = value;
    }
}
