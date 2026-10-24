/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.moaagent.agent.interaction.narration.NarrationOutput;

/** Skill 协议适配；依据宿主身份封装，而不是在通用播放器中猜测阶段。 */
final class SkillNarrationOutput {
    private SkillNarrationOutput() { }

    static NarrationOutput wrap(NarrationOutput target) {
        return target;
    }
}
