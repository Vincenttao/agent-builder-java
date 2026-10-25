---
name: deepagent-platform-development
description: 为平台开发者维护DeepAgent运行范式、CORE工具契约、应用开发指导与空业务模板，准备可发行修订；不代替应用开发者编写特定业务。
---

## 平台维护流程

1. 读取SOURCE.md、template.json、RUNTIME.md和当前用户涉及的Java、测试或开发指导。来源是agent-solution guides/docs-java/how-to/deepagent.md；上游能力和本机已接线能力分开说明。
2. 定位修改层：运行工具/完成判定属于固定Java；开放的配置与工具格式属于本地契约；用户如何开发属于应用开发Skill。仅修改当前需求相关层，不顺手加入某个客户业务。
3. 接口变化时，核对`.opencode/skills/deepagent-application-development/references/assembly-contract.md`、操作目录、应用开发Skill及相关测试。已接通工具才可开放装配；新增工具不能只改JSON。维护指导时给出触发条件、关联文件、可执行步骤及完成标准。
4. 检查兼容影响：新建仍为空业务；保留会话隔离、逐轮Skill授权、仅brief.md、写后读回、完成信号和有限循环；已有发行版与应用不自动升级。说明需要迁移的地方，不覆盖历史发行版。
5. 真实编辑并读回。交付修改文件、原因、兼容影响、静态核对及未执行检查。由用户在工作台审阅后发行固定版本；编码任务不自行发布、升级应用或启动额外模型任务。

## 角色与验证边界

平台维护范式代码、CORE工具、操作契约、两类开发指导及模板发行。应用开发者依据应用Skill维护scope、System Prompt和业务Skill。模板skills与scope.own保持空，不把材料、会议、商城或理财预置为范式。

OpenCode禁止Bash，不能声称编译或Java测试已通过。指导修改只核对文档引用、格式和空模板边界；改Java才需要平台在后续运行对应Java检查。结构、构建、真实模型和企业发布分别记录，不以一个替代另一个。技术凭据始终由本地外置配置提供。
