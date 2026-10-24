/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.routing.context;

import com.openjiuwen.core.singleagent.rail.ModelCallInputs;

/**
 * 将服务带出信息的公开投影注入模型上下文。
 *
 * @since 0.1.0
 */
public final class DefaultModelContextContributor implements ModelContextContributor {
    @Override
    public void contribute(ModelCallInputs inputs, Context context) {
        LeadOutModelProjection.project(inputs, IntentHandoff.modelProjection(context.serviceLeadOut()),
                context.query());
    }
}
