/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.interaction;

import com.moaagent.agent.support.Json;
import com.moaagent.agent.support.MetadataSnapshot;
import com.openjiuwen.core.session.stream.OutputSchema;

import java.util.LinkedHashMap;
import java.util.Map;

public record OutputEvent(String type, Map<String, Object> fields) {
    /**
     * 保存结构化语义输出的元数据键。
     */
    public static final String METADATA_KEY = "moa.output";

    /**
     * 保存封装前原始事件类型的元数据键。
     */
    public static final String SEMANTIC_TYPE_KEY = "moa.semanticType";

    public OutputEvent {
        if (type == null || type.isBlank()) {
            throw new IllegalArgumentException("Missing output event type");
        }
        Map<String, Object> copy = new LinkedHashMap<>(fields);
        copy.remove("event");
        copy.putIfAbsent("content", "");
        fields = MetadataSnapshot.copy(copy, Integer.MAX_VALUE);
    }

    /**
     * 根据事件类型与字段创建结构化输出事件。
     *
     * @param type 结构化输出的事件类型
     * @param fields 事件内容及附加字段
     * @return 根据给定类型和字段构造的输出事件
     */
    public static OutputEvent of(FrontendEventType type, Map<String, Object> fields) {
        return new OutputEvent(type.wireName(), fields);
    }

    /**
     * 从输出字段快照解析结构化事件。
     *
     * @param payload 包含事件类型和内容的输出字段
     * @return 解析得到的结构化输出事件
     */
    public static OutputEvent fromPayload(Map<String, Object> payload) {
        return new OutputEvent(String.valueOf(payload.getOrDefault("event", "message")), payload);
    }

    /**
     * 判断事件是否属于指定类型。
     *
     * @param expected 待比较的事件类型
     * @return 事件类型与指定类型一致时返回 true
     */
    public boolean is(FrontendEventType expected) {
        return type.equals(expected.wireName());
    }

    /**
     * 读取事件正文。
     *
     * @return 事件正文；未提供正文时为默认空字符串
     */
    public Object content() {
        return fields.get("content");
    }

    /**
     * 读取事件中的结构化业务数据。
     *
     * @return 结构化业务数据；不存在时返回空映射
     */
    public Map<String, Object> data() {
        return Json.object(fields.get("data"));
    }

    /**
     * 返回包含事件类型的输出字段快照。
     *
     * @return 包含事件类型及内容字段的输出快照
     */
    public Map<String, Object> payload() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("event", type);
        payload.putAll(fields);
        return payload;
    }

    /**
     * 转换为运行时输出报文，指定事件名时保留原始语义类型。
     *
     * @param index 运行时输出报文的序号
     * @return 类型为 custom 的运行时输出报文
     */
    public OutputSchema toOutputSchema(int index) {
        return new OutputSchema("custom", index, payload());
    }

    /**
     * 转换为运行时输出报文，指定事件名时保留原始语义类型。
     *
     * @param index 运行时输出报文的序号
     * @param eventName 对外输出使用的事件名称
     * @return 类型为 custom 的运行时输出报文
     */
    public OutputSchema toOutputSchema(int index, String eventName) {
        if (eventName == null || eventName.isBlank()) {
            throw new IllegalArgumentException("Missing output event name");
        }
        Map<String, Object> payload = payload();
        payload.put("event", eventName);
        if (!eventName.equals(type)) {
            payload.put(SEMANTIC_TYPE_KEY, semantic().type());
        }
        return new OutputSchema("custom", index, payload);
    }

    /**
     * 根据原始语义标记还原事件类型。
     *
     * @return 恢复原始语义类型后的事件；无有效标记时返回当前事件
     */
    public OutputEvent semantic() {
        if (!(fields.get(SEMANTIC_TYPE_KEY) instanceof String original) || original.isBlank()) {
            return this;
        }
        Map<String, Object> semanticFields = new LinkedHashMap<>(fields);
        semanticFields.remove(SEMANTIC_TYPE_KEY);
        return new OutputEvent(original, semanticFields);
    }
}
