/*
 * Copyright (c) Huawei Technologies Co., Ltd. 2026-2026. All rights reserved.
 */

package com.moaagent.agent.skill;

import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.error.YAMLException;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 限定 Skill 资源访问范围，并校验和读取 Markdown 及脚本资产。
 *
 * @since 0.1.0
 */
public final class SkillAssets {
    private final Path root;
    private final Map<Path, String> files;
    private final String entry;

    public SkillAssets(String directory, String entrySkill) throws IOException {
        if (directory == null || directory.isBlank() || entrySkill == null || !entrySkill.matches("[A-Za-z0-9_-]+")) {
            throw new IllegalArgumentException("必须配置 Skill 根目录和入口名称");
        }
        root = Path.of(directory).toRealPath();
        if (!Files.isDirectory(root)) {
            throw new IllegalArgumentException("Skill 根路径必须是目录: root=" + root);
        }
        Map<Path, String> loaded = new LinkedHashMap<>();
        long size = 0L;
        try (var paths = Files.walk(root, 8)) {
            for (Path path : paths.filter(Files::isRegularFile).toList()) {
                if (!path.toString().endsWith(".md") && !path.toString().endsWith(".py")
                        && !path.toString().endsWith(".yml") && !path.toString().endsWith(".yaml")
                        && !path.toString().endsWith(".json")) {
                    continue;
                }
                if (!path.toRealPath().startsWith(root) || Files.size(path) > 262144 || loaded.size() >= 256) {
                    throw new IllegalArgumentException("Skill 资产越界或超限");
                }
                String content = Files.readString(path);
                size += content.length();
                if (size > 2_000_000) {
                    throw new IllegalArgumentException("Skill 资产总大小超限");
                }
                loaded.put(path.toAbsolutePath().normalize(), content);
            }
        }
        files = Map.copyOf(loaded);
        try {
            entry = read(entrySkill + "/SKILL.md");
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Skill 入口加载失败: configuredRoot=" + directory + ", realRoot=" + root
                    + ", entry=" + entrySkill + "/SKILL.md", exception);
        }
        if (!entry.startsWith("---")) {
            throw new IllegalArgumentException("入口 SKILL.md 必须包含原生 Skill frontmatter");
        }
    }

    /**
     * 返回已验证且授权的 Skill 资源根目录。
     *
     * @return 返回已验证且授权的 Skill 资源根目录
     */
    public String root() {
        return root.toString();
    }

    /**
     * 返回已加载的入口 Skill Markdown 内容。
     *
     * @return 入口 Skill 的执行说明
     */
    public String entry() {
        return entry;
    }

    /**
     * 读取授权根目录内的资源，拒绝越界路径。
     *
     * @param name 部署声明的名称
     * @return 读取授权根目录内的资源，拒绝越界路径
     */
    public String read(String name) {
        Path path = root.resolve(name).toAbsolutePath().normalize();
        if (!path.startsWith(root)) {
            throw new IllegalArgumentException("未授权的 Skill 资源: reason=outside_root, root=" + root
                    + ", resource=" + name);
        }
        if (!files.containsKey(path)) {
            throw new IllegalArgumentException("未授权的 Skill 资源: reason=not_loaded, root=" + root
                    + ", resource=" + name
                    + ", loadedFileCount=" + files.size()
                    + "; 检查文件是否已部署、大小写、相对路径及目录软链接（不递归跟随）");
        }
        return files.get(path);
    }

    /**
     * 读取已授权的脚本资源。
     *
     * @param name 部署声明的名称
     * @return 读取已授权的脚本资源
     */
    public String script(String name) {
        if (name == null || !name.endsWith(".py")) {
            throw new IllegalArgumentException("脚本必须是已注册的 Python 资源");
        }
        return read(name);
    }

    /**
     * 读取并校验资产目录内的 input/result/summary 独立契约文件。
     *
     * @param name 资产目录中的契约文件名
     * @return 解析并校验后的契约
     */
    public Map<String, Object> contract(String name) {
        String source = read(name);
        Object value;
        try {
            value = new Yaml(new SafeConstructor(new LoaderOptions())).load(source);
        } catch (YAMLException exception) {
            throw new IllegalArgumentException("Skill 契约文件解析失败: " + name, exception);
        }
        Map<String, Object> contract = SkillSchema.object(value);
        if (!contract.keySet().containsAll(java.util.Set.of("input", "result"))) {
            throw new IllegalArgumentException("Skill 契约文件必须包含 input 和 result: " + name);
        }
        return contract;
    }
}
