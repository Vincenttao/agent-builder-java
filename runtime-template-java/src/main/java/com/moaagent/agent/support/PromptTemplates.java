/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.support;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Set;

/**
 * 加载内置提示词并校验允许外置的模板名称与内容。
 *
 * @since 0.1.0
 */
public final class PromptTemplates {
    /**
     * 框架支持外置配置的提示词名称集合。
     */
    public static final Set<String> NAMES = Set.of("orchestration", "native-skill", "task-cardinality",
            "intent-arbitration", "condition-evaluation", "service-lead-out");

    private PromptTemplates() { }

    /**
     * 加载指定名称的内置提示词。
     *
     * @param name 已注册的提示词名称
     * @return 指定名称的内置提示词文本
     */
    public static String defaultPrompt(String name) {
        requireName(name);
        String resource = "/prompts/" + name + ".md";
        try (var input = PromptTemplates.class.getResourceAsStream(resource)) {
            if (input == null) {
                throw new IllegalStateException("缺少默认提示词：" + resource);
            }
            return requireText(new String(input.readAllBytes(), StandardCharsets.UTF_8));
        } catch (IOException exception) {
            throw new IllegalStateException("无法读取默认提示词：" + resource, exception);
        }
    }

    /**
     * 校验提示词名称属于框架支持的范围。
     *
     * @param name 已注册的提示词名称
     */
    public static void requireName(String name) {
        if (!NAMES.contains(name)) {
            throw new IllegalArgumentException("未知提示词名称：" + name);
        }
    }

    /**
     * 校验提示词文本非空并返回原始内容。
     *
     * @param text 待校验的提示词文本
     * @return 已校验为非空的原始提示词文本
     */
    public static String requireText(String text) {
        if (text == null || text.isBlank()) {
            throw new IllegalArgumentException("提示词不能为空");
        }
        return text;
    }
}
