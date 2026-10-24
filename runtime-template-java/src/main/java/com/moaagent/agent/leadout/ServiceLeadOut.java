/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.leadout;

import java.util.List;
import java.util.Locale;

/**
 * 面向前端的结构化服务带出结果。该对象只包含业务展示字段，不包含执行脚本、适配器或内部智能体信息。
 *
 * @param schema 载荷版本
 * @param source 结果来源，例如 SKILL 或 BUSINESS
 * @param trigger 触发任务
 * @param items 推荐服务
 * @since 0.1.0
 */
public record ServiceLeadOut(String schema, String source, ServiceLeadOutTrigger trigger,
        List<ServiceLeadOutItem> items) {
    /** 当前版本的服务带出协议标识。 */
    public static final String SCHEMA = "moa.service_lead_out.v1";

    /** 可公开给前端的来源值。 */
    public static final String SOURCE_SKILL = "SKILL";

    /**
     * SOURCE_L2
     */
    public static final String SOURCE_L2 = "L2";

    /**
     * SOURCE_BUSINESS
     */
    public static final String SOURCE_BUSINESS = "BUSINESS";

    public ServiceLeadOut {
        schema = schema == null || schema.isBlank() ? SCHEMA : schema;
        source = normalizeSource(source);
        items = items == null ? List.of() : List.copyOf(items);
    }

    /**
     * 将业务结果中的来源值收敛为公开协议值，避免内部 adapter、脚本或 agent 标识泄漏到前端。
     *
     * @param value 业务结果提供的来源值
     * @return 协议允许的公开来源值
     */
    public static String normalizeSource(String value) {
        if (value == null || value.isBlank()) {
            return SOURCE_SKILL;
        }
        return switch (value.trim().toUpperCase(Locale.ROOT)) {
            case SOURCE_SKILL -> SOURCE_SKILL;
            case SOURCE_L2 -> SOURCE_L2;
            case SOURCE_BUSINESS -> SOURCE_BUSINESS;
            default -> SOURCE_BUSINESS;
        };
    }
}
