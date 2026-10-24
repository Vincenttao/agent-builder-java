/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.leadout;

/**
 * 一个可展示但不会自动执行的后续服务建议。
 *
 * @param capabilityId 目录中的能力标识
 * @param title 对客展示名称
 * @param hint 对客提示语
 * @param interaction 前端交互类型，例如 BUTTON 或 TEXT
 * @param risk 目录声明的风险等级
 * @since 0.1.0
 */
public record ServiceLeadOutItem(String capabilityId, String title, String hint, String interaction, String risk,
        String declineResponse, String sourceTask) {
    public ServiceLeadOutItem(String capabilityId, String title, String hint, String interaction, String risk) {
        this(capabilityId, title, hint, interaction, risk, "", "");
    }
    @org.springframework.boot.context.properties.bind.ConstructorBinding
    public ServiceLeadOutItem {
        declineResponse = declineResponse == null ? "" : declineResponse;
        sourceTask = sourceTask == null ? "" : sourceTask;
        if (declineResponse.length() > 2048 || sourceTask.length() > 256) {
            throw new IllegalArgumentException("带出应答或来源超出预算");
        }
        capabilityId = capabilityId == null ? "" : capabilityId;
        title = title == null ? "" : title;
        hint = hint == null ? "" : hint;
        interaction = interaction == null || interaction.isBlank() ? "BUTTON" : interaction;
        risk = risk == null ? "LOW" : risk;
    }
}
