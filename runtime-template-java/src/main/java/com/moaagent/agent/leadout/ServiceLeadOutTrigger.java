/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.leadout;

/**
 * 描述触发服务带出的已完成任务。
 *
 * @param taskId 任务标识
 * @param capabilityId 能力标识
 * @param capabilityName 能力名称
 * @since 0.1.0
 */
public record ServiceLeadOutTrigger(String taskId, String capabilityId, String capabilityName) {
}
