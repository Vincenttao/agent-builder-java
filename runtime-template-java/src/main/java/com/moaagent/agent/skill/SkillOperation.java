/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.skill.environment.ScriptEnvironmentBindings;

import org.springframework.boot.context.properties.bind.ConstructorBinding;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 描述 Skill 操作的执行方式、脚本、参数约束、确认和环境绑定配置。
 *
 * @since 0.1.0
 */
public record SkillOperation(Type type, String title, String adapter, String intent, String queryTemplate,
        String beforeScript, String resultScript, Map<String, Object> inputSchema, Map<String, Object> outputSchema,
        Map<String, String> metadataBindings, boolean confirmationRequired, boolean terminal, int maxCalls,
        ScriptEnvironmentBindings scriptEnvironment, Map<String, SkillResultBinding> inputBindings,
        Map<String, Object> fixedArguments, boolean internal, String nextOperation,
        Map<String, Object> summarySchema, String contractFile) {
    /**
     * 区分远端委派操作和脚本操作。
     *
     * @since 0.1.0
     */
    public enum Type {
        A2A,
        SCRIPT
    }

    public SkillOperation(Type type, String title, String adapter, String intent, String queryTemplate,
            String beforeScript, String resultScript, Map<String, Object> inputSchema, Map<String, Object> outputSchema,
            Map<String, String> metadataBindings, boolean confirmationRequired, boolean terminal, int maxCalls) {
        this(type, title, adapter, intent, queryTemplate, beforeScript, resultScript, inputSchema, outputSchema,
                metadataBindings, confirmationRequired, terminal, maxCalls, null);
    }

    public SkillOperation(Type type, String title, String adapter, String intent, String queryTemplate,
            String beforeScript, String resultScript, Map<String, Object> inputSchema, Map<String, Object> outputSchema,
            Map<String, String> metadataBindings, boolean confirmationRequired, boolean terminal, int maxCalls,
            ScriptEnvironmentBindings scriptEnvironment) {
        this(type, title, adapter, intent, queryTemplate, beforeScript, resultScript, inputSchema, outputSchema,
                metadataBindings, confirmationRequired, terminal, maxCalls, scriptEnvironment, null, null,
                false, null, null, null);
    }

    /**
     * 兼容已有 Java 调用方的完整内联契约构造方式。
     *
     * @param type 操作类型
     * @param title 操作名称
     * @param adapter 远端适配器
     * @param intent 远端意图
     * @param queryTemplate 请求模板
     * @param beforeScript 前置脚本
     * @param resultScript 结果脚本
     * @param inputSchema 输入契约
     * @param outputSchema 输出契约
     * @param metadataBindings 元数据绑定
     * @param confirmationRequired 是否需要确认
     * @param terminal 是否为终止操作
     * @param maxCalls 最大调用次数
     * @param scriptEnvironment 脚本环境
     * @param inputBindings 输入绑定
     * @param fixedArguments 固定参数
     * @param internal 是否仅内部调用
     * @param nextOperation 后续操作
     */
    public SkillOperation(Type type, String title, String adapter, String intent, String queryTemplate,
            String beforeScript, String resultScript, Map<String, Object> inputSchema, Map<String, Object> outputSchema,
            Map<String, String> metadataBindings, boolean confirmationRequired, boolean terminal, int maxCalls,
            ScriptEnvironmentBindings scriptEnvironment, Map<String, SkillResultBinding> inputBindings,
            Map<String, Object> fixedArguments,
            boolean internal, String nextOperation) {
        this(type, title, adapter, intent, queryTemplate, beforeScript, resultScript, inputSchema, outputSchema,
                metadataBindings, confirmationRequired, terminal, maxCalls, scriptEnvironment, inputBindings,
                fixedArguments, internal, nextOperation, null, null);
    }

    /**
     * Inline summary contract without an external contract file.
     *
     * @param type 操作类型
     * @param title 操作名称
     * @param adapter 远端适配器
     * @param intent 远端意图
     * @param queryTemplate 请求模板
     * @param beforeScript 前置脚本
     * @param resultScript 结果脚本
     * @param inputSchema 输入契约
     * @param outputSchema 输出契约
     * @param metadataBindings 元数据绑定
     * @param confirmationRequired 是否需要确认
     * @param terminal 是否为终止操作
     * @param maxCalls 最大调用次数
     * @param scriptEnvironment 脚本环境
     * @param inputBindings 输入绑定
     * @param fixedArguments 固定参数
     * @param internal 是否仅内部调用
     * @param nextOperation 后续操作
     * @param summarySchema 摘要契约
     */
    public SkillOperation(Type type, String title, String adapter, String intent, String queryTemplate,
            String beforeScript, String resultScript, Map<String, Object> inputSchema, Map<String, Object> outputSchema,
            Map<String, String> metadataBindings, boolean confirmationRequired, boolean terminal, int maxCalls,
            ScriptEnvironmentBindings scriptEnvironment, Map<String, SkillResultBinding> inputBindings,
            Map<String, Object> fixedArguments, boolean internal, String nextOperation,
            Map<String, Object> summarySchema) {
        this(type, title, adapter, intent, queryTemplate, beforeScript, resultScript, inputSchema, outputSchema,
                metadataBindings, confirmationRequired, terminal, maxCalls, scriptEnvironment, inputBindings,
                fixedArguments, internal, nextOperation, summarySchema, null);
    }

    /**
     * modelInputSchema
     *
     * @return Map<String,Object>
     */
    public Map<String, Object> modelInputSchema() {
        Map<String, Object> schema = new LinkedHashMap<>(inputSchema);
        Map<String, Object> properties = new LinkedHashMap<>(SkillSchema.object(inputSchema.get("properties")));
        properties.keySet().removeAll(inputBindings.keySet());
        properties.keySet().removeAll(fixedArguments.keySet());
        schema.put("properties", properties);
        schema.put("required", ((List<?>) inputSchema.get("required")).stream()
                .filter(properties::containsKey).toList());
        return schema;
    }

    /**
     * 由资产目录加载独立契约文件，加载后不再依赖 inline schema。
     *
     * @param assets 当前 Skill 的资产目录
     * @return 契约已解析的操作；未配置契约文件时返回当前操作
     */
    public SkillOperation resolveContract(SkillAssets assets) {
        if (contractFile == null || contractFile.isBlank()) {
            return this;
        }
        Map<String, Object> contract = assets.contract(contractFile);
        Map<String, Object> input = SkillSchema.object(contract.get("input"));
        Map<String, Object> result = SkillSchema.object(contract.get("result"));
        Map<String, Object> summary = contract.containsKey("summary")
                ? SkillSchema.object(contract.get("summary")) : summarySchema;
        return new SkillOperation(type, title, adapter, intent, queryTemplate, beforeScript, resultScript,
                input, result, metadataBindings, confirmationRequired, terminal, maxCalls, scriptEnvironment,
                inputBindings, fixedArguments, internal, nextOperation, summary, null);
    }

    private static boolean missing(String value) {
        return value == null || value.isBlank();
    }

    @ConstructorBinding
    public SkillOperation {
        beforeScript = missing(beforeScript) ? null : beforeScript;
        resultScript = missing(resultScript) ? null : resultScript;
        contractFile = missing(contractFile) ? null : contractFile;
        scriptEnvironment = scriptEnvironment == null ? new ScriptEnvironmentBindings(null, null) : scriptEnvironment;
        if (beforeScript == null && !scriptEnvironment.beforeScript().isEmpty()) {
            throw new IllegalArgumentException("没有 before-script 的操作不能绑定前置脚本环境变量");
        }
        if (resultScript == null && !scriptEnvironment.resultScript().isEmpty()) {
            throw new IllegalArgumentException("没有 result-script 的操作不能绑定结果脚本环境变量");
        }
        metadataBindings = metadataBindings == null ? Map.of() : Map.copyOf(metadataBindings);
        if (type == null || missing(title) || maxCalls < 1 || maxCalls > 100) {
            throw new IllegalArgumentException("Skill 工具授权缺少类型、标题或调用预算");
        }
        if (type == Type.A2A && (missing(adapter) || missing(intent) || missing(queryTemplate))) {
            throw new IllegalArgumentException("A2A 工具缺少固定路由与请求模板");
        }
        if (type == Type.SCRIPT && resultScript == null) {
            throw new IllegalArgumentException("SCRIPT 操作缺少执行实现：当前脚本执行入口由 result-script 注册");
        }
        boolean externalContract = contractFile != null && !contractFile.isBlank();
        if (!externalContract && (inputSchema == null || outputSchema == null)) {
            throw new IllegalArgumentException("Skill 工具必须声明 input-schema/output-schema 或 contract-file");
        }
        inputSchema = SkillSchema.normalize(inputSchema == null ? emptyObject() : inputSchema);
        outputSchema = SkillSchema.normalize(outputSchema == null ? emptyObject() : outputSchema);
        summarySchema = SkillSchema.normalize(summarySchema == null ? emptyObject() : summarySchema);
        inputBindings = inputBindings == null ? Map.of() : Map.copyOf(inputBindings);
        fixedArguments = fixedArguments == null ? Map.of() : Map.copyOf(fixedArguments);
        nextOperation = missing(nextOperation) ? null : nextOperation;
        if (!"object".equals(inputSchema.get("type")) || !"object".equals(outputSchema.get("type"))) {
            throw new IllegalArgumentException("工具输入输出必须是对象");
        }
        if (!"object".equals(summarySchema.get("type"))) {
            throw new IllegalArgumentException("模型摘要必须是对象");
        }
        Map<String, Object> properties = SkillSchema.object(inputSchema.get("properties"));
        if (inputBindings.keySet().stream().anyMatch(fixedArguments::containsKey)
                || !externalContract && (!properties.keySet().containsAll(inputBindings.keySet())
                || !properties.keySet().containsAll(fixedArguments.keySet()))) {
            throw new IllegalArgumentException("后台输入绑定必须引用独立的已声明参数");
        }
        if (!externalContract) {
            fixedArguments.forEach((name, value) -> SkillSchema.validate(SkillSchema.object(properties
                    .get(name)), value));
        }
        if ((internal && (confirmationRequired || terminal)) || (terminal && nextOperation != null)) {
            throw new IllegalArgumentException("组合内部步骤不能要求确认或终结任务");
        }
    }

    private static Map<String, Object> emptyObject() {
        return Map.of("type", "object", "properties", Map.of(), "required", List.of(),
                "additionalProperties", false);
    }
}
