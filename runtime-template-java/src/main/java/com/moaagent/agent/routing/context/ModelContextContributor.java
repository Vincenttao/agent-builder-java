/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.routing.context;

import com.openjiuwen.core.session.AgentSessionApi;
import com.openjiuwen.core.singleagent.rail.ModelCallInputs;

import java.util.Map;

/**
 * 定义业务上下文进入模型提示词的投影扩展点。
 *
 * @since 0.1.0
 */
@FunctionalInterface
public interface ModelContextContributor {
    /**
     * 向当前模型调用注入允许公开的业务上下文。
     *
     * @param inputs 待增强的模型调用输入
     * @param context 当前会话、用户输入与服务带出公开上下文
     */
    void contribute(ModelCallInputs inputs, Context context);

    record Context(AgentSessionApi session, String query, Map<String, Object> serviceLeadOut) {
        public Context {
            serviceLeadOut = IntentHandoff.projection(serviceLeadOut);
        }
    }
}
