# Agent Builder 文档

面向类似大型银行 AI 平台部门开发人员的一站式 Agent 开发／测试平台，暂名 agent-builder。目标是通过开发与测试两个 Agent，自动开发 Agent、Skill、Rail、Tool，并完成独立验收与本地 Mock 演示。当前已走通设备只读 Tool／Skill 生成、候选验收、同制品发布与有限修复；Agent／Rail 自动生成及完整平台验收仍待完成。首期 P0 使用 trusted-local 模式，暂不建设执行沙箱。

首次体验请看[仓库 README](../README.md)；日常操作与开发请看[详细操作指南](操作指南.md)；团队介绍请直接用浏览器打开[项目汇报 HTML](项目汇报.html)，支持阅读／汇报模式、交互架构说明和打印。

| 文档 | 内容 |
| --- | --- |
| [后续推进计划与执行要求](后续推进计划与执行要求.md) | 当前工作入口：RP-01 样例 Demo 优先，随后身份分离、资源回收、Skill 增量与真实生成；按变化检查和证据过渡规则 |
| [技术设计复审与轻量化方案](技术设计复审与轻量化方案_2026-10-24.md) | 交付速度与磁盘现场调查、重复 SDK/JAR 根因、固定样例 Demo、测试分层与资源回收建议；尚未实施 |
| [需求文档 v0.1](NL2Agent_需求文档_v0.1.md) | 产品范围、双 Agent 自动开发、受限生成、数据契约、验收用例与 P0-A/B/C 阶段 |
| [技术设计 v0.2](NL2Agent_技术设计_v0.1.md) | TypeScript 平台、Java 底座、内容与执行身份分离、增量候选、兼容迁移与部署 |
| [TDD 开发计划 v0.2](NL2Agent_TDD开发计划_v0.1.md) | 适当层次的 TDD、按变化检查、原 TD 工作包映射和正式验收边界 |
| [首个开发切片与验证记录](implementation/TDD-001.md) | 草稿与环境诊断的实际实现、红绿测试、PostgreSQL／浏览器／Docker／模型验证及剩余范围 |
| [Java 适配与验收门禁](implementation/TDD-002.md) | 固定 SDK、真实 DeepSeek／AgentServer／Tool／Rail、阶段清单与证据判断 |
| [实施进度](implementation/PROGRESS.md) | TD-01～TD-15 当前完成范围与剩余事项 |
| [受限生成与双角色工程任务](implementation/TDD-013.md) | 真实 OpenCode／DeepSeek 生成 Tool 与 Skill、红绿单测、构建、取消及证据 |
| [生成候选与测试入口](implementation/TDD-014.md) | 固定生成 JAR、SDK Skill 装载和 test-api 真实执行的前序记录 |
| [候选验收与发布绑定](implementation/TDD-015.md) | 每用例独立测试部署、HTTP 验收、候选／测试计划／报告绑定、同一 JAR 发布及 Docker 回归 |
| [完整工单模板验收](implementation/TDD-017.md) | 八项场景、参数变化失效、外部工单绑定、五分钟过期与 Docker 同制品发布 |
| [失败证据驱动的有限修复](implementation/TDD-016.md) | 原报告与源码绑定、旧代码缺陷复现、固定方案复用、新候选回归和三次修复预算 |
| [交互设计 v0.2](NL2Agent_交互设计_v0.1.md) | 四流程页签、单版本上下文、各页输入与操作、详情抽屉及交互验收；待实施设计，沿用原文件路径 |
| [企业模拟环境 v0.1](NL2Agent_企业模拟环境_v0.1.md) | 模拟 App、余额／理财／申购 API、接口生成 Skill、场景数据、故障注入与业务证据 |
| [测试与验收基线 v0.2](NL2Agent_测试与验收基线_v0.1.md) | 保留 P0-A/B/C 必测集合，更新批次执行、证据复用过渡与整改检查要求 |
| [PRD 评审与续评](NL2Agent_PRD评审_2026-10-22.md) | 原始评审问题、用户澄清及本次处理状态 |

参与项目设计时，建议按“PRD → 技术设计 → 测试与验收基线 → TDD 开发计划”阅读，结合交互设计和 Mock 契约实施。平台采用 TypeScript 模块化单体与独立 Runner，Compose 统一部署，业务 Agent 运行在固定版本 openJiuwen Java 上。实际验证范围见各批实施记录；目标设计不表示代码已经存在或阶段验收通过。原型完成后另行评审交付成功率。
