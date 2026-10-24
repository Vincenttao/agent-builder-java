/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.ToolCallInputs;
import com.openjiuwen.core.singleagent.rail.AgentRail;

import java.util.Set;

/** 接手已校验的 Skill 请求，提前覆盖模型等待；内部技术轮次不逐层播报。 */
final class SkillNarrationRail extends AgentRail {
    private final SkillNarration narration;

    SkillNarrationRail(SkillNarration narration) {
        this.narration = narration;
    }

    @Override
    public int getPriority() {
        return 1900; // 在 SkillBoundaryRail(2000) 验证／恢复执行身份之后运行。
    }

    @Override
    public void beforeInvoke(AgentCallbackContext ctx) {
        narration.begin(ctx.getSession());
    }

    @Override
    public void beforeModelCall(AgentCallbackContext ctx) {
        narration.model(ctx.getSession());
    }

    @Override
    public void beforeToolCall(AgentCallbackContext ctx) {
        if (ctx.getInputs() instanceof ToolCallInputs inputs
                && Set.of("ask_user", "confirm_action", "cancel_skill")
                        .contains(inputs.getToolName())) {
            narration.stop(ctx.getSession(), "tool_handoff");
        }
        // read_file / list_skill / skill_results 不改变用户正在办理的业务，不结束并重播提示。
    }

    @Override
    public void onModelException(AgentCallbackContext ctx) {
        narration.stop(ctx.getSession(), "failed");
    }

    @Override
    public void onToolException(AgentCallbackContext ctx) {
        narration.stop(ctx.getSession(), "interrupted_or_failed");
    }

    @Override
    public void afterInvoke(AgentCallbackContext ctx) {
        narration.end(ctx.getSession(), "request_finished");
    }
}
