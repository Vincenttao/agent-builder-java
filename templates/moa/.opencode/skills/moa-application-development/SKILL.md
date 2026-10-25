---
name: moa-application-development
description: 基于 MOA 范式装配应用，统一修改业务范围、System Prompt、Skill 和允许的局部代码，并给出可审阅差异。
---

先读取 application.json、instructions.md、已有 skills 文件及 SOURCE.md；按当前需求修改，不能把空 MOA 模板当成预建福利应用。

来源：agent-solution 的 MOA 二次开发指导，固定提交 552294d013b28a79d912a5bda9f627237e826e6b；Core develop 0.1.17 / Runtime develop 0.1.4 的实际适配以本工程为准。平台维护技术范式；应用开发者维护下层业务范围、操作分工和业务 Skill。

## 从业务需求到工程修订

用户只需描述业务目标和必要的业务连接信息；工具名称、脚本协议、配置字段从本Skill及references读取，不要求用户提供技术实现提示。先识别当前应用的相关范围/Skill和已接通操作，再联合编辑配置、System Prompt、业务Skill及必要脚本。业务目标明确时自行选择合理的Skill标识和文件组织；只有缺少真实端点、业务规则或授权选择时提问。交付前用读取工具核对实际文件和引用，不以文字建议代替编辑。

业务Skill必须以YAML frontmatter开头，含name与单行description；name与application.json中Skill id一致，file指向skills/<id>/SKILL.md。operations引用真实操作目录。业务Skill须写清原生桥接工具名和参数结构（SCRIPT经call_mcp，A2A经call_versatile），不能仅写“调用操作名”；读成功后按授权终结契约收束，TODO或文字完成不代表业务执行。业务Skill指导当前任务如何处理业务；本开发Skill指导OpenCode如何开发工程，两者分开。

## 必须遵守

- 当前应用的业务范围包括自己用 Skill 处理与委派挂载 Agent；范围外按配置转交，不把所有后续输入重新分发。
- 业务 Skill 是当前任务内能力，不新增业务待办。首期共两层 A/B，只恢复未结束的 A；保留 A/B 时阻断第三层。
- application.json 与 instructions.md、业务 Skill 有冲突时联合修订，说明来源、影响和理由；目标不明先提问。
- 不覆盖固定运行代码、pom.xml 或本开发 Skill；仅修改 application.json、instructions.md、skills/、adapters/、tests/ 和开放的 app 适配代码。
- 保留参数校验、确认绑定、幂等、未知结果核对和只读回放。不能用提示词放宽程序约束。
- 使用真实文件编辑工具交付；输出修改文件、简要理由和实际运行的检查。没有执行的检查标为未执行。

## 当前本机运行契约

涉及可执行业务资产时，先读取本 Skill 的 `references/workbench-runtime-contract.md`。它明确本项目的操作目录、脚本路径与输入输出、字段映射、确认及终结规则；与固定上游参考分别标识。当前 OpenCode 禁止 Bash，未实际运行的检查必须注明未执行。

## i豆首个示例的装配约定

只有用户提出员工福利/i豆需求时才加入该业务。创建 skills/ideabean/SKILL.md，定义余额查询、礼品目录、参数补充、确认兑换及原订单查询。
配置 scope.own、scope.delegated、scope.outside 和 capabilities；连接地址来自任务明确提供的本机独立 Mock，不含凭据。余额嵌套响应路径使用 mapping.balancePath。受控采购委派和范围外接管目标必须有真实配置。
遇到已有待确认任务时，补充/确认归原任务；业务切换按保留/询问/放弃策略，恢复后先复核并重新确认，不自动重发已提交写入。

## 交付前核对

JSON 可解析，schemaVersion=1，handoff.maxTasks=2。每个 Skill 的 file 引用存在；各入口描述一致。若提供tests/routing-examples.json，先按本机运行契约“路由预演样例的文件格式”核对case顶层query/action/target；业务答案预期不能替代路由字段。对自己修改的内容运行适用检查。最后返回简短变更说明；不要输出密钥、完整上下文或无关文件。

完整机制参考本 Skill 的 references/native-skill-agent.md、request-routing.md、rail-extension.md 和 intent-switch.md，均固定到 SOURCE.md 声明的来源提交。涉及旧 Core API 的部分以本工程兼容适配和实际测试为准。

## 版本化业务回归

新增或修订业务测试时，先读取 [用例Schema与执行边界](references/business-tests.md)。编辑 tests/business-cases.json 中的声明式步骤和独立断言，不生成任意Shell命令。只核对文件和引用，由工作台调用已保存版本的原运行执行；禁止以COMPLETED覆盖外部状态或局部修改保留断言，禁止为消除失败修改独立验收预期。
