# 来源与适用范围

agent-solution 本地 common 分支，提交 089822db38f23f2458abc804e0818d2194414ca4。

- guides/docs-java/how-to/deepagent.md：目标导向文件交付物、工厂、任务循环与完成判定。
- guides/docs-java/examples/deepagent/src/main/java/com/openjiuwen/examples/deepagent/agent/DeepAgentDefinition.java：工厂装配示例。
- 同目录 WorkspaceFileTools.java：工具卡、LocalFunction 与路径边界的参考。

本模板为本项目编写的简化适配；固定 Core 0.1.17 / Runtime 0.1.4，不复制 MOA 业务实现。文档包含可选 SubAgent/A2A，本模板未装配。

当前Core公开了skillDirectories/skills配置与Skill工具；本工作台首批使用受限Skill装配适配：从保存版本的application.json读取允许的Skill文件与操作，注册LocalFunction形式的skill_tool，不扫描未装配Skill，也不放行任意相对路径。文件工具按本轮已加载Skill的operations再次校验。不是直接宣称完整SkillHub或任意脚本可用。
