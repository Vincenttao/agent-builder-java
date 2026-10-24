/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction;

import java.util.regex.Pattern;

/**
 * 当前确认中断的明确肯定词；不解析自由文本，也不用于候选选择或远端业务应答。
 *
 * @since 0.1.0
 */
public final class ConfirmationResponses {
    private static final String AFFIRMATIVE = "确认|确认执行|确定|是|好|好的|同意|[oO][kK]|[yY][eE][sS]";
    private static final Pattern APPROVAL = Pattern.compile("\\s*(?:" + AFFIRMATIVE + ")\\s*");

    private ConfirmationResponses() {
    }

    /**
     * 判断答复是否整体匹配明确肯定词，忽略两端空白及英文词大小写。
     *
     * @param response 当前确认中断的用户答复
     * @return 是否明确批准
     */
    public static boolean approved(Object response) {
        return response instanceof String text && APPROVAL.matcher(text).matches();
    }

    /**
     * 返回确认入口共用的输入提示。
     *
     * @return 简短的确认或拒绝提示
     */
    public static String hint() {
        return "请回复“确认”或“拒绝”。";
    }
}
