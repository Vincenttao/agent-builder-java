/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.rail;

import com.openjiuwen.core.singleagent.rail.AgentRail;

import java.util.List;

/**
 * * 为每次 Agent 创建提供额外 Rail；实现可作为 Spring Bean 注册。
 *
 * @since 0.1.0
 */
@FunctionalInterface
public interface MoaAgentRailProvider {
    /**
     * 创建当前角色的 Rail。每次调用应返回新实例，不适用时返回空列表。
     *
     * @param role Agent 的运行角色，不表示 L1/L2 层级
     * @return 按注册顺序排列的 Rail，不得包含 null 或重复实例
     */
    List<AgentRail> createRails(Role role);

    /**
     * Agent 的运行角色，不表示 L1/L2 层级。
     */
    enum Role {
        MAIN, SKILL
    }
}
