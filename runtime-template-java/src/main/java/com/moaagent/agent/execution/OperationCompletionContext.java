/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.execution;

import com.openjiuwen.core.session.AgentSessionApi;

import java.util.Objects;

/** Live callback context, separate from the immutable completion snapshot; not for asynchronous retention. */
public record OperationCompletionContext(AgentSessionApi session, String query) {
    public OperationCompletionContext {
        Objects.requireNonNull(session, "session");
        if (query == null || query.isBlank()) {
            throw new IllegalArgumentException("Missing operation query");
        }
    }
}
