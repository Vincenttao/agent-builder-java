/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.discovery;

import java.util.List;

public record HandoffSpec(Mode mode, List<String> candidateCapabilityIds) {
    /**
     * Mode
     *
     * @since 2026-10-06
     */
    public enum Mode {
        TARGET, SELECT, COMPOSE
    }

    public HandoffSpec {
        mode = mode == null ? Mode.TARGET : mode;
        candidateCapabilityIds = candidateCapabilityIds == null ? List.of() : List.copyOf(candidateCapabilityIds);
        if (candidateCapabilityIds.size() > 32 || candidateCapabilityIds.stream()
                .anyMatch(id -> !id.matches("[A-Za-z0-9][A-Za-z0-9._:-]*"))
                || candidateCapabilityIds.stream().distinct().count() != candidateCapabilityIds.size()
                || mode == Mode.TARGET && !candidateCapabilityIds.isEmpty()) {
            throw new IllegalArgumentException("交接候选范围无效");
        }
    }

    /**
     * target
     *
     * @return HandoffSpec
     */
    public static HandoffSpec target() {
        return new HandoffSpec(Mode.TARGET, List.of());
    }
}
