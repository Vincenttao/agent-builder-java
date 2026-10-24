/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.rail;

import com.openjiuwen.core.singleagent.rail.AgentRail;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * * 保留内置 Rail，并按 Provider 顺序追加业务 Rail。
 *
 * @since 0.1.0
 */
public final class MoaAgentRails {
    private MoaAgentRails() { }

    /**
     * 保留内置 Rail，并追加当前角色的业务 Rail，校验重复实例和空值。
     *
     * @param role 当前 Agent 的运行角色
     * @param builtIns 需要保留的框架内置 Rail
     * @param providers 按注册顺序排列的业务 Rail 工厂
     * @return 包含内置及业务扩展 Rail 的不可变列表
     */
    public static List<AgentRail> assemble(MoaAgentRailProvider.Role role,
            List<? extends AgentRail> builtIns, List<MoaAgentRailProvider> providers) {
        Objects.requireNonNull(role, "Agent role must not be null");
        List<AgentRail> rails = new ArrayList<>(builtIns);
        for (MoaAgentRailProvider provider : providers) {
            List<AgentRail> extensions = Objects.requireNonNull(provider.createRails(role),
                    "Rail provider must return a list: " + provider.getClass().getName());
            rails.addAll(extensions);
        }
        Set<AgentRail> instances = Collections.newSetFromMap(new IdentityHashMap<>());
        for (AgentRail rail : rails) {
            Objects.requireNonNull(rail, "Rail must not be null");
            if (!instances.add(rail)) {
                throw new IllegalArgumentException("Duplicate Rail instance: " + rail.getClass().getName());
            }
        }
        return List.copyOf(rails);
    }
}
