---
name: deepagent-application-development
description: 根据独立业务目标维护 DeepAgent 的工作区交付物范式与应用指令，不引入 MOA 路由或任务接管。
---
先读 template.json、SOURCE.md、application.json、instructions.md 和 RUNTIME.md。
本范式来自 agent-solution guides/docs-java/how-to/deepagent.md：使用 HarnessFactory.createDeepAgent、TaskCompletionRail、受限文件工具。
模板是通用独立目标范式，不预置短材料业务。根据用户目标创建skills/<id>/SKILL.md，装配adapters/operations.json中已接通的CORE文件工具，再关联业务范围和System Prompt。材料整理只在examples/deepagent-materials中作为应用示例。
应用角色可开发并装配业务Skills，修改业务范围、instructions.md、adapters和tests；平台角色维护 Java 工具、完成判定与模板发行。不要添加伪操作或把未注册的工具声明为可用。
保留每会话独立工作区、只读写 brief.md、写后读回、有限轮次、外置模型配置。不得把素材或交付物存进源码提交，不得放入密钥。
使用与MOA一致的开发、能力、编排、测试和交付流程；差异只在模板执行策略。当前未接通A2A/SubAgent时不得伪称可用，后续可按范式扩展。不要声称完成没有执行的测试。

## 业务Skill的必需格式与交付前自检

每个业务Skill文件必须以YAML frontmatter开头，不得直接从Markdown标题开始：

```markdown
---
name: 与application.json中的Skill标识一致
description: 一行用途说明，不换行
---

业务指导正文
```

用read工具读回新增文件，核对文件头、Skill标识、operations引用与当前已接通的CORE工具。需要首次交付与局部修改两例。若工作台结构检查指出缺少文件头，保持业务正文和验收预期不变，只修复格式；不能关闭检查，也不能声称Bash或业务测试已通过。
