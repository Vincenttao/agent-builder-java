/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.support;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 生成隔离可变对象且限制大小的元数据快照。
 *
 * @since 0.1.0
 */
public final class MetadataSnapshot {
    private MetadataSnapshot() { }

    /**
     * 复制并限制元数据快照大小，隔离可变嵌套对象。
     *
     * @param source 待投影或复制的原始字段
     * @param maxCharacters 序列化元数据允许的最大字符数
     * @return 隔离可变嵌套对象后的只读元数据快照
     */
    public static Map<String, Object> copy(Map<String, Object> source, int maxCharacters) {
        if (source == null || source.isEmpty()) {
            return Map.of();
        }
        String json = Json.write(source);
        if (json.length() > maxCharacters) {
            throw new IllegalArgumentException("Metadata exceeds its size budget");
        }
        return freezeMap(Json.object(json), 0);
    }

    private static Map<String, Object> freezeMap(Map<String, Object> source, int depth) {
        Map<String, Object> result = new LinkedHashMap<>();
        source.forEach((key, value) -> result.put(key, freeze(value, depth + 1)));
        return Collections.unmodifiableMap(result);
    }

    private static Object freeze(Object value, int depth) {
        if (depth > 32) {
            throw new IllegalArgumentException("Metadata nesting exceeds its budget");
        }
        if (value instanceof Map<?, ?>) {
            return freezeMap(Json.object(value), depth);
        }
        if (value instanceof List<?> list) {
            return list.stream().map(item -> freeze(item, depth + 1)).toList();
        }
        return value;
    }
}
