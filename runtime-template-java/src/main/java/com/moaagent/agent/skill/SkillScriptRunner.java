/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import com.openjiuwen.core.session.AgentSessionApi;

import java.util.Map;

/**
 * 定义沙箱脚本执行接口，支持按操作和阶段传递环境变量绑定。
 *
 * @since 0.1.0
 */
@FunctionalInterface
public interface SkillScriptRunner {
    /**
     * 在沙箱中执行授权脚本并返回其结构化结果。
     *
     * @param session 当前请求所属会话
     * @param source 待读取的数据来源
     * @param input 待解析的输入数据
     * @return 在沙箱中执行授权脚本并返回其结构化结果
     */
    Map<String, Object> run(AgentSessionApi session, String source, Map<String, Object> input);

    /**
     * 在沙箱中执行授权脚本并返回其结构化结果。
     *
     * @param session 当前请求所属会话
     * @param source 待读取的数据来源
     * @param input 待解析的输入数据
     * @param context 本次调用及配置绑定上下文
     * @return 在沙箱中执行授权脚本并返回其结构化结果
     */
    default Map<String, Object> run(AgentSessionApi session, String source, Map<String, Object> input,
            com.moaagent.agent.skill.environment.ScriptEnvironmentContext context) {
        if (!context.bindings().isEmpty()) {
            throw new IllegalStateException("当前脚本执行器不支持环境变量绑定");
        }
        return run(session, source, input);
    }
}
