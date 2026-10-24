/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction;

/**
 * 框架展示事件的语义类型及默认名称；前端事件名可由响应格式化 SPI 定制。
 * todolist_* 用于列出规划，todo_start/todo_end 用于单项任务执行生命周期。
 *
 * @since 0.1.0
 */
public enum FrontendEventType {
    THINK_CHUNK("think_chunk"),
    THINK_END("think_end"),
    TODOLIST_START("todolist_start"),
    TODOLIST_ITEM("todolist_item"),
    TODOLIST_END("todolist_end"),
    TODO_START("todo_start"),
    TODO_END("todo_end"),
    TODO_SKIPPED("todo_skipped"),
    TODO_BLOCKED("todo_blocked"),
    INTERRUPT_START("interrupt_start"),
    SERVICE_LEAD_OUT("service_lead_out"),
    FINAL_ANSWER_CHUNK("final_answer_chunk");

    private final String wireName;

    FrontendEventType(String wireName) {
        this.wireName = wireName;
    }

    String wireName() {
        return wireName;
    }
}
