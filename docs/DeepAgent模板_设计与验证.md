# DeepAgent：同一工作台中的另一种开发范式

2026-10-25。MOA与DeepAgent共用装配式开发流程；模板提供范式与开放能力，业务应用在模板上装配Skill、工具和已接通的Agent。**短材料整理是基于DeepAgent的应用示例，不是DeepAgent模板的定义。**

## 共同流程与范式差异

共同流程：选择模板发行版 → 定义业务范围/System Prompt → 开发并装配业务Skill与工具 → Coding辅助编排 → 检查和真实调试 → 固定版本交付。平台维护范式、执行器、工具契约和开发Skill；应用开发者维护业务Skill、装配关系和应用指令，两类角色都能查看及按授权简单修改代码。

| 工作对象 | 共同产品设计 | DeepAgent当前执行策略 |
| --- | --- | --- |
| 模板与应用 | 从固定发行版本创建；不把某个业务变成范式 | 空业务DeepAgent模板；材料整理在应用中添加 |
| 能力 | 同一能力目录，显示来源、契约和接入状态 | 首批接通Skill及CORE文件工具；Agent/A2A、HTTP/MCP仍为未接通或草稿 |
| Skill与工具 | `application.json.skills[].operations`、`skills/*/SKILL.md`、`adapters/operations.json` | 模型先通过受限skill_tool读取已装配Skill，再调用该Skill允许的工具 |
| 编排 | 同一“处理流程/范围/Skill/规则预演”结构，Coding提出关联修订 | 模型围绕目标选择Skill和工具；任务循环与完成Rail决定收束，不冒充固定DAG |
| 运行与交付 | 保存版本、检查、运行记录、只读回放和技术导出 | 会话工作区交付物；本版不提供MOA的A/B接管和DeepAgent OTel |

模板应声明开放能力，而不是在产品层永久禁止DeepAgent调用其他Agent。未来接通SubAgent/A2A或其他工具后，复用同一装配界面与契约；**现有配置项、文档能力和已接通执行器分开标识**。

## 源码依据与实现边界

阅读 solution 本地 `common@089822db38f23f2458abc804e0818d2194414ca4`：`guides/docs-java/how-to/deepagent.md`，以及 `guides/docs-java/examples/deepagent/src/main/java/com/openjiuwen/examples/deepagent/agent/{DeepAgentDefinition,WorkspaceFileTools}.java`。指南实际位于guides，仓库没有顶层docs。

DeepAgent适合目标导向、多步骤且持续维护工作区文件的业务；单次问答优先ReAct，确定性控制流优先Workflow。采用HarnessFactory工厂、TaskLoop和TaskCompletionRail。固定Core0.1.17/Runtime0.1.4；指南的完成超时参数Duration与本机JAR的Double秒不一致，按实际构件适配为180.0。[依赖摘要](../templates/deepagent/runtime-source.json)记录了实际版本与摘要。

Core公开skillDirectories/skills和Skill工具接口。本工作台首批采用受限装配适配：[SkillAssembly.java](../runtime-deepagent-java/src/main/java/com/openjiuwen/workbench/deep/SkillAssembly.java)只读取当前保存版本声明的Skill文件，注册LocalFunction形式的skill_tool/list_skills；不扫描未装配Skill、不读取用户提供的任意相对路径，不宣称完整SkillHub已经接通。文件工具在执行时再次校验本轮所选Skill的operations，未装配操作被拒绝。

模板源在[templates/deepagent](../templates/deepagent/README.md)，业务示例在[examples/deepagent-materials](../examples/deepagent-materials/README.md)。[BusinessApplication.java](../runtime-deepagent-java/src/main/java/com/openjiuwen/workbench/BusinessApplication.java)加载保存版本的业务范围、指令与装配，Runtime的JiuwenCoreAgentHandler执行原生DeepAgent；同会话复用AgentSession和独立工作区。每轮必须重新读取业务Skill，开发用.opencode Skill与运行时业务Skill不同。

当前文件工具只读写brief.md，拒绝路径越界、符号链接和超限内容；权限默认拒绝其他工具。框架初始化的工作区说明/记忆文件不是应用交付物。应用代码、业务输入、生成材料分别保管，运行材料不进入Git或导出包。完成核实包括完成信号、非空文件和本轮写后读回，不能仅凭模型说“完成”。

护栏配置：最多8次模型迭代、3轮目标循环、180秒完成超时；每运行20个会话，每会话20轮/256条事件，交付物50KB。显式模型探测最多保留3个独立工作区，超限先审阅历史证据，不自动清理。企业权限治理、任意脚本、上传/PDF解析、跨重启续办和DeepAgent OTel不在本批已接通范围。

## 验证与证据

- 新Java模板5项测试和打包通过：文件边界/符号链接/写后读回、同会话修改与隔离、仅声称完成不能通过、真实Core工厂创建/关闭、Skill装配和工具集合限制。首次新增类红灯及构造参数不兼容的失败记录保留。
- 装配式版本有专门PC/API测试：空业务模板、添加Skill、选择CORE工具、共享能力目录、两类角色的开发Skill隔离，以及MOA编排/运行回归。技术导出独立验证模板身份、单目标说明和运行材料排除；不代替交付包独立部署验收。
- 真实deepseek-flash两轮装配验证：空模板加material-notes业务Skill和文件工具；第一轮整理“登录完成、支付超时、小王、周五排查”；第二轮改为“下周一”并保留其他事实。每轮实际加载Skill；首轮“Skill→写→读”，次轮“Skill→读→写→读”，两轮均核实通过。使用虚构材料和真实Java/模型，不是预制响应。

本机证据在`test-results/deepagent-template-20261025/`。最新装配式真实探测为`.workbench/verification/deepagent-live-2026-10-25T05-58-50.376Z/`；先前收窄场景的试作探测也保留，但不混入最终装配验收。探测结束后停止所属Java进程。未新增真实OpenCode生成、金融交易、企业CI/CD或完整PRD验收；具体样例成功不等于所有业务正确。

本机当前装配发行版为DeepAgent1.1.0，示例为“短材料整理（装配示例）”。早先1.0.0场景试作保留来源并明确标识历史，不进入新建应用的可选项。旧应用和运行保留。
