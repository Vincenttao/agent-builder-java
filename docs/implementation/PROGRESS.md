# 实施进度

目标：完成 TDD 计划至 TD-15，包括 P0-A/B/C 累积必测集及 NF-01～NF-06。状态：开发中，尚未完成阶段验收。

TDD-085：刷新当前固定镜像上的 AC-24、AC-30、NF-05 及相关验收证据。NF-05 通过：项目在新 Compose 工作区导入，重建生成物、部署并完成 Mock 查询，App 重启后恢复包仍一致；目标栈已清理，源 Runner 暂停后于 340372 ms 恢复健康。P0-A 70/70 通过；P0-B 96/170、P0-C 101/235 通过，其余分支未验证，无硬失败。TD-15 尚未完成。详见 [TDD-085](TDD-085.md)，其中附有 P0-A/B/C 报告。

TDD-083：修复 GitHub CI 中 manifest 摘要未同步及 Java Adapter 首次 `--no-checkout` 克隆被误判为源码改动的问题；Artifact 缺失不再覆盖主失败。摘要合同 1 项、单元／契约 130 项、类型检查通过；Core／Runtime 构建和 Bridge 23 项测试通过。Adapter 全套本地运行在并行负载下超时并已停止，等待修复提交后的 GitHub CI 验证。详见 [TDD-083](TDD-083.md)。

TDD-082：将“固定代码候选构建一次、同一 App／Runner 镜像批量执行多项验收”的要求同步至 FR-019/020、测试基线及 TDD 阶段门禁；补充用例状态隔离、破坏性测试顺序、失败分类与重建触发条件。P0-A/B/C 必测集合未删减。TD-15 仍暂停，未执行 Docker 构建或测试。详见 [TDD-082](TDD-082.md)。

TDD-081：移除 Docker 构建中重复的 Node 类型检查、单元／契约测试和 Java Bridge 测试；保留生产编译／打包、OpenCode 版本校验及 TD-15 真实运行验收。CI 仍负责执行完整质量检查。未执行 Docker 重建，首次后续镜像构建需验证新配置。详见 [TDD-081](TDD-081.md)。

TDD-073：固定 NF-01 App／Runner 镜像上，双角色任务受限生成余额 Java Tool 与 Skill，测试先红后绿、契约检查、构建及制品打包通过；固定候选的真实 Mock 余额、缺少账户号、接口超时三项验收全部通过，轨迹包含 Skill 加载、Tool 调用及超时错误，写操作数为 0。目标镜像为 `sha256:ff6a983717690800c550aab825f82a01cf361935ddd6ab782617eb27b54ef256`／`sha256:b412d6decab76629735dd1b2d10f5cd8cf8ff33742fad8334e0d58f912e3aa36`。证据见 [TDD-073](TDD-073.md)。这仅关闭金融余额只读生成和运行路径；TDD-070 的 P0-A/B/C 报告绑定旧镜像，必须在当前目标上刷新全量门禁；金融产品资料、申购及异常恢复、扩展生成、多项 AC 与 NFR 分支仍未完成或未验证，TD-15 未完成。

TDD-074：修正 NF-05／NF-06 验证脚本的认证 Origin 配置，刷新 NF-04、NF-06、AC-19、EQ-01/02 与 NF-05 真实部署证据，并按当前镜像重新组装 86 条分支。P0-A 70/70 通过；P0-B 81/170、P0-C 86/235，剩余项为未验证。详见 [TDD-074](TDD-074.md)。

TDD-075：增加 AC-24 Runner 开发目录篡改、Tester MCP 写拒绝、候选 JAR 篡改检测和固定候选真实运行验证；四个部署态分支通过。当前累计结果为 P0-A 70/70、P0-B 85/170、P0-C 90/235。详见 [TDD-075](TDD-075.md)。

TDD-076：在当前镜像上刷新 AC-23 的越界目录、命令、依赖和生产连接策略证据，四个部署态分支通过。累计门禁提升为 P0-A 70/70、P0-B 89/170、P0-C 94/235；剩余分支保持未验证。详见 [TDD-076](TDD-076.md)。

TD-15 回归续跑：NF-06 的 Runner 流程约束分支纳入当前 Docker AC-23/24 越界操作与候选完整性证据，P0-B/P0-C 各新增 1 个通过分支。最新为 P0-A 70/70、P0-B 90/170、P0-C 95/235；NF-06 的候选/报告完整性、环境独立、评测记录仍未验证。详见 [TDD-077](TDD-077.md)。

TDD-078：在当前 NF-01 Docker Mock 服务验证 AC-30 同种子初始化、环境间状态隔离、活动运行／未知写入时重置拒绝以及重置后历史保留，五个分支通过；NF-06“独立环境”分支复用并绑定同一实测证据。累计门禁为 P0-A 70/70、P0-B 96/170、P0-C 101/235。详见 [TDD-078](TDD-078.md)；业务 Agent 跨环境运行、其余未验证回归仍未完成。

TDD-079：当前源码宿主机集成环境用真实 DeepSeek 重跑预置 86→87 温度缺陷、失败报告、复用固定 Tester 方案、修复新候选、3 项回归、发布和业务查询，完整流程成功。证据不属于当前 Docker 目标，AC-26 不计通过；P0 门禁维持 70/70、96/170、101/235。详见 [TDD-079](TDD-079.md)。

| 工作包 | 当前证据与缺口 |
| --- | --- |
| TD-01 契约与环境 | 已有草稿契约、类型检查、认证与环境阻塞诊断；完整运行环境检查待接入 |
| TD-02 需求与版本 | 已有字段来源／逐项确认、修订历史、受限装配与不可变快照；独立验收基线审阅、内容摘要确认与持久化已部署；TDD-057 增加写入目标的确认要求和接口资源缺口提示，AC-03 三分支在隔离浏览器通过；完整模型问答与变更分析待实现 |
| TD-03 SDK 装配与工具 | 固定 Core／Runtime 构建，真实 DeepAgent／三个 Rail／HTTP 与 MCP Tool 验证；TDD-054 已贯通 RuntimeSpec 协议／版本／连接绑定、受控 Run 上下文代理、Mock MCP 只读端点及调用事件；隔离 Docker 中 HTTP／MCP 两次真实 Run 均成功，AC-07 两分支证据已保存 |
| TD-04 运行与事件 | 已有平台 Run、持久化事件／SSE 续读、执行请求去重、设备只读完整链路；共享 JVM 取消与事件隔离、worker 心跳／接管、旧 worker 回写拒绝和 Runner 迟到命令拒绝已验证。依赖恢复可继续运行／审批；完整会话恢复、孤儿进程处理待实现 |
| TD-05 工单审批与幂等 | 原生 SDK 中断／续接、持久化动作、参数绑定、并发决定、拒绝、过期和写后超时核对已通过完整服务链路测试；Docker 真实 DeepSeek 页面审批通过；完整 AC／EQ 分支仍待阶段验收 |
| TD-06 验收、发布与导出 | 模板与生成候选的设备只读验收、真实发布准备／冒烟、原子指针／历史和管理页面回滚已部署；报告绑定候选、测试计划与实际 JAR，发布复用同一制品。TDD-022 将候选 RuntimeSpec 摘要贯通测试与发布入口；TDD-027/028 增加不含凭据的需求／装配／完整基线用例 JSON 包；TDD-029 增加真实 Runner 中固定生成源码／Skill／Rail／测试文件、候选依赖和可校验恢复材料；TDD-030 将导入包持久保存并在工作台重新读取。基于源码创建新 DevelopmentJob、重建 JAR、Mock 场景数据、执行证据及新目录完整恢复仍待实现 |
| TD-07 金融场景与 App | 持久化 Mock 金融基础接口、身份、原子账本与幂等已验证；模拟 App 已接入已发布设备 Agent 的请求／恢复／取消／决策入口。金融 Agent、金融 App 场景和跨消息 SDK 上下文仍待实现 |
| TD-08 执行器与候选 | 已有进程树控制、固定 JVM 部署、Runner HTTP、持久化工程任务、受限生成、真实红绿单测和固定代码包。生成 Tool／Skill 已组合为独立 JAR 并在 JVM 实际加载，候选登记与源文件／SDK／运行规格摘要校验通过，已部署并通过 Docker 真实模型页面流程 |
| TD-09 候选测试入口 | TestDeployment 和 test-api 已接入统一请求／Run 处理；自动执行器实际通过 HTTP 运行只读三项和工单模板八项场景，分别固定故障环境并停止部署。报告核验候选、装载清单及同一 Run 的生成组件事件；取消、接管、重试与陈旧授权拒绝已回归 |
| TD-10 双角色与独立验收 | 真实 OpenCode 测试／开发双会话、基线方案、生成单测红绿与平台契约检查已接入。固定设备场景的候选执行、测试计划摘要及报告绑定已部署。TDD-016 已实现失败证据驱动的有限修复，固定旧测试与方案、先复现缺陷再生成新候选并回归；工单模板八项在 TDD-017 补齐；可扩展测试方案与写组件自动生成仍待实现 |
| TD-11 变更与交付绑定 | 门禁及业务入口检查版本／实际 Mock 摘要；升级后拒绝旧报告并重新验收／发布有真实证据。完整变更分析、环境兼容范围及导入导出待实现 |
| TD-12 Agent／Rail 与写场景 | TDD-021 增加参数化工具调用上限 Rail 模板及真实 SDK hook／边界验证；TDD-022 贯通候选 RuntimeSpec 与测试／发布绑定；TDD-023 已通过一次真实 DeepSeek 双角色生成受限 Rail JSON 并绑定候选规格。Rail 独立行为验收、Skill 接口包装、Agent 工程生成与写场景仍待实现 |
| TD-13 写结果核对 | 工单写后超时按原幂等键查询、确认唯一外部写入及工单参数绑定已在 TDD-017 真实 Docker 验收；金融及完整异常分支仍待实现 |
| TD-14 交付能力评测 | 任务包已定义；原型完成后执行，尚未形成成功率 |
| TD-15 部署与质量回归 | TDD-070 已在当前固定 App／Runner 镜像 `sha256:f8a2387…`／`sha256:0962ff…` 上刷新 NF-01、AC-01～07、AC-11/14～16/19/21/22、AC-42a、EQ-01/02、NF-02～06、NF-05 等关键证据；P0-A 70/70 分支通过。P0-B 为 81/170、P0-C 为 86/235，未验证分支仍分别为 89 和 149；金融业务生成／运行及多项隔离、发布、重置、扩展回归仍缺实现或证据。TD-15 尚未完成。详见 [TDD-070](TDD-070.md) 和最新门禁报告。 |

最新固定镜像门禁中，P0-A 70 个必需分支全部通过；P0-B 与 P0-C 仍含未验证分支。单元／组件测试不能替代对应的部署态分支证据，必须保持基线、镜像、运行与证据绑定。

实施记录：[TDD-001](TDD-001.md)、[TDD-002](TDD-002.md)、[TDD-003](TDD-003.md)、[TDD-004](TDD-004.md)、[TDD-005](TDD-005.md)、[TDD-006](TDD-006.md)、[TDD-007](TDD-007.md)、[TDD-008](TDD-008.md)、[TDD-009](TDD-009.md)、[TDD-010](TDD-010.md)、[TDD-011](TDD-011.md)、[TDD-012](TDD-012.md)、[TDD-013](TDD-013.md)、[TDD-014](TDD-014.md)、[TDD-015](TDD-015.md)、[TDD-016](TDD-016.md)、[TDD-017](TDD-017.md)。工单模板八项已补齐；下一批扩展 Agent／Rail 与写组件自动开发，金融场景、导出、会话恢复与最终部署回归继续保留在目标内。

TDD-018 页面增量：组件目录、依赖联动与装配预览已接入现有快照和候选流程；Skill 是否绑定按实际候选来源显示。范围和验证见 [TDD-018](TDD-018.md)。

TDD-019 页面增量：开发 Agent 区已参考本地开发工作台的信息层级，展示真实任务阶段和双角色职责；前端构建并更新本地 Docker 静态页面。未运行测试。详见 [TDD-019](TDD-019.md)。

TDD-020 页面增量：四流程页签、单选测试版本、发布门禁与对话入口已接入现有 API；TypeScript 检查和前端构建通过，未运行测试。部署状态和边界见 [TDD-020](TDD-020.md)。

TDD-021：按 FR-018 增加 Skill／Rail／Agent／写组件的分阶段验收门槛；首个可配置 Rail 模板通过真实 DeepAgent 调用限制测试、跨 Run 与会话检查。该 Rail 目前由用户配置，尚未接入双角色自然语言生成。详见 [TDD-021](TDD-021.md)。

TDD-022：Candidate 固定有效 RuntimeSpec 摘要，测试部署、业务入口、Run、发布和冒烟均使用同一规格；定向单测、契约与 PostgreSQL 集成测试通过。当前工程任务仍不能生成与快照不同的 Agent/Rail 规格。详见 [TDD-022](TDD-022.md)。

TDD-023：Profile v3 开放 Rail 定义文件；平台限制模板和参数，校验后从快照规格派生候选规格。一次真实双角色任务已生成合法 Rail 定义并构建候选，但尚无 Rail 超限行为验收。详见 [TDD-023](TDD-023.md)。

TDD-024：增加可重复的本机 NF-03 API 基准脚本并运行。Docker App 镜像 `sha256:bd5511be…` 下保存／列表 P95 均低于 1 秒目标，专用记录已清理。该结果不代表之后修改的 Runner 镜像、未部署 App 工作区或生产硬件基线。详见 [TDD-024](TDD-024.md)。

TDD-025：修复生成任务 TDD 红测的有效性校验及测试冻结；真实 DeepSeek/OpenCode 双角色成功生成并构建一份受限 Tool 调用上限 Rail 候选。该证据不含 Rail 超限行为和发布验收。详见 [TDD-025](TDD-025.md)。

TDD-026：保留 Runner 升级前已发布模板及生成组件的固定制品身份，并修复服务端的历史版本绑定判定；Docker 重建后旧发布 Agent 业务查询冒烟通过。该证据只覆盖空闲已发布部署的重启恢复，不代表 TD-15 全项完成。详见 [TDD-026](TDD-026.md)。

TDD-027：提供基础项目包导出／导入及 Web 入口，重新生成本地快照并显式要求验收基线确认、连接重绑；增加 `APP_PORT` 配置。源码／JAR、Mock 场景和完整证据尚未打包，NF-05 与 AC-18 仍未完整通过。详见 [TDD-027](TDD-027.md)。

TDD-057：按 FR-002/003 增加写入目标的确认要求与缺失接口提示；保留无关字段，表单／引导视图一致。隔离 Docker 上 AC-03 三个浏览器断言通过；全量 P0-A 报告仍需在新 App 镜像上重跑。详见 [TDD-057](TDD-057.md)。

TDD-058：修正本地真实 Java Runtime 测试使用旧 Bridge JAR 导致的启动等待；重建后 Runner 租约接管／取消／旧 worker fencing 用例通过，并固化为 NF-06 子项证据。该证据是确定性适配器测试，不作为 live Docker 或完整 NF-06 通过结论。详见 [TDD-058](TDD-058.md)。

TDD-028：项目包增加验收基线中的业务需求与完整用例内容，导入重新确认时保留原始审阅材料，并校验基线内部摘要；类型检查、97 项单测／契约和 96 项集成测试通过。生成源码／JAR、场景数据、证据、浏览器迁移和新目录恢复仍待完成。详见 [TDD-028](TDD-028.md)。

TDD-029：自动开发项目包增加来自真实 Runner Bundle 的生成源码、配置、候选摘要和可核验制品依赖；全套 99 项单测／契约、96 项集成、Edge 浏览器下载／导入用例通过。Docker App 已部署；真实环境 43 个项目导出成功。导入后的任务恢复、Mock 场景和全新目录验证仍待完成。详见 [TDD-029](TDD-029.md)。

TDD-030：导入恢复包持久保存在数据库，可从新项目再次读取，工作台支持查看源码与制品依赖；迁移 014 已部署。恢复材料目前仍需后续流程创建开发任务和重建候选，尚不能直接重新验收。详见 [TDD-030](TDD-030.md)。

TDD-031：项目导出包增加来自 Mock 服务实际使用的版本化场景定义、10 个 API 操作摘要和 2 组确定性种子；摘要校验、恢复材料 UI、Docker 部署与 Edge 导入回归通过。场景尚未按项目实例化，导入后还不能重建候选或重新验收，因此 AC-18、AC-40、NF-05 仍未通过。详见 [TDD-031](TDD-031.md)。

TD-15 验收门禁复核：重新运行 `pnpm test:acceptance`，P0-A 的 29 个验收项下共 70 个必测分支全部未验证。当前 manifest 的 `testFile` 为空，且命令没有独立固定候选目标与分支执行证据；组件／集成测试通过不能自动转成 P0-A 通过。下一批应先补齐必测分支到可执行验证及受管证据的映射，再按固定目标执行门禁。

TDD-032：针对当前部署 App 镜像重跑 NF-03 本地基准，保存与列表各 100 次、5 并发，P95 分别为 17.64 ms 和 17.40 ms，失败为 0，专用数据清理完成。该结果只证明本机普通草稿接口的有限负载表现，不关闭 NF-03 全项或 P0-A。详见 [TDD-032](TDD-032.md) 及 [基准证据](evidence/TD15-NF03-benchmark.json)。

TDD-033：App 启用结构化请求日志，并脱敏 URL、Authorization、Cookie、CSRF 头；运行态假凭据未出现在错误响应、导出包或非空 App 容器日志。新 App 镜像 `sha256:bac4f8f0…` 已部署，readiness、四服务健康与 Edge 项目包导入回归通过。该哨兵只覆盖一个受控输入和日志窗口，不代表 NF-02 全面通过。详见 [TDD-033](TDD-033.md) 与 [运行证据](evidence/TD15-NF02-live.json)。

TDD-034：当前部署上完成一次成功终态 Run 的 Postgres、Mock、Runner、App 全栈重启；Run、事件、Runner 执行记录、Mock 调用、动作和业务状态均精确保持，未发生重复外部调用；新会话可恢复草稿／快照，旧管理会话失效。运行中崩溃、未知写入对账、审批等待和双会话／SSE 分支仍未覆盖，故 NF-01 尚未完整通过。详见 [TDD-034](TDD-034.md) 与 [运行证据](evidence/TD15-NF01-live.json)。

TDD-035：Compose 已对 App、Runner、Mock、迁移和 PostgreSQL 实际启用 Docker `json-file` 日志轮转（每容器 10 MiB、3 文件），从容器 HostConfig 逐个核验通过；业务 Run 事件不按此策略删除，当前无 TTL。服务健康与 Edge 项目包回归通过。它只完成 NF-04 的日志容量策略，不代表业务事件清理或 NF-04 完整通过。详见 [TDD-035](TDD-035.md) 与 [实际配置证据](evidence/TD15-NF04-retention-config.json)。

TDD-036：在当前部署用 20 秒预算启动一项真实受限开发任务，实际触发 `ENGINEERING_BUDGET_EXCEEDED`；Tester 角色被确认取消、Developer 未启动，任务以可识别失败终态结束，失败记录保留。该证据只覆盖开发任务总时限，不覆盖业务 Agent 轮次上限、所有错误分类或全量 NF-04。详见 [TDD-036](TDD-036.md) 与 [运行证据](evidence/TD15-NF04-budget-live.json)。

TDD-037：OpenJiuwen Harness 中 `maxIterations=1` 的重复工具循环测试通过，完整 Java Bridge Verify 17 项全绿；部署态 API 对需求、装配、连接和运行时限分别返回不同诊断码。前者是实际 SDK 上的确定性模型替身测试，后者是有限错误样例；线上 Agent 限轮及全量错误路径尚未验证，NF-04 仍未完整通过。详见 [TDD-037](TDD-037.md)、[轮次证据](evidence/TD15-NF04-iteration-test.json) 和 [错误分类证据](evidence/TD15-NF04-errors-live.json)。

TDD-038：真实固定候选在 `maxIterations=1` 下最多进行一次模型调用和一次只读设备工具调用；平台将通用 JVM 查询失败结合 Runtime 轮次事件归类为 `ITERATION_LIMIT_REACHED`，保留原始错误并确认部署停止。App／Runner 镜像构建、101 项单元／契约、17 项 Java Bridge 和 98 项集成测试通过。Run 是可解释的失败终态，不是业务成功；全量 NF-04 和 P0-A/B/C 仍未完成。详见 [TDD-038](TDD-038.md) 与 [真实候选证据](evidence/TD15-NF04-iterations-live.json)。

TDD-039：为 P0-A 的 29 个验收项／70 个分支建立候选测试引用映射，校验所有引用存在并绑定当前 manifest 摘要；所有验收状态仍明确为未验证。`pnpm test:acceptance` 仍显示未验证，因为 live-mock 固定目标报告尚未由执行器生成。详见 [TDD-039](TDD-039.md) 与 [覆盖映射](../../tests/acceptance/p0-a-coverage-map.json)。

TDD-040：使用真实 Java Bridge 和延迟模型 HTTP 请求验证 Runner 持久状态恢复：进行中执行恢复为 `interrupted`，部署被跳过，重复请求不重放，模型端调用数保持 1。Adapter 测试 3 项通过；本次未真实杀死 Docker Runner，也没有覆盖未知写操作，因此 NF-01 和 P0-A 仍未通过。详见 [TDD-040](TDD-040.md)。

TDD-041：隔离 Docker 中对 App／Runner 执行 SIGKILL，真实 Mock `write-after-timeout` 工单写入保持恰好一笔，Runner journal 与 Run 均为 `interrupted`，未观察到重放。验证部署仍停在 `stopping`，没有完整八场景报告；恢复脚本的端口变量缺陷已记录并修正，隔离服务恢复后主演示仍健康。此证据只证明“不重复写”，NF-01 与 P0-A/B/C 继续未验证。详见 [TDD-041](TDD-041.md) 与 [故障证据](evidence/TD15-NF01-active-write-restart.json)。

TDD-042：针对 Runner 重启后无法确认 JVM 是否退出导致 TestDeployment 卡在 `stopping`，DeploymentRecord 持久化子进程 PID；PID 明确不存在才允许退役，仍存活或缺少 PID 时继续隔离。真实 Java 适配测试 5 项、测试部署／验证集成测试 17 项及类型检查通过。Docker 故障后完整验收报告尚待复测，NF-01 和 P0-A/B/C 仍未通过。详见 [TDD-042](TDD-042.md)。

TDD-043：隔离 Docker 真实写后超时场景完成八项验证报告。TC-001～007 通过；TC-008 的 Run 在 App／Runner SIGKILL 后正确为 `interrupted`，因此总体用例诚实失败，但零审批前写入、写调用一次、业务工单一笔、参数绑定和幂等键核对等七项安全断言全部通过；TestDeployment 最终停止，没有重放。修复了 interrupted 部署跨 Runner 重启隔离、已终态执行不阻断退役、成功退役清除陈旧诊断及脚本重登。18 项集成测试、5 项真实 JVM 适配、101 项单测／契约、类型检查通过。该证据不证明故障后业务 Run 自动成功，NF-01 全项及 P0-A/B/C 仍未完成。详见 [TDD-043](TDD-043.md) 与 [复验报告](evidence/TD15-NF01-active-write-restart-retest.json)。

TDD-044：在独立 Compose 栈更新 NF-01～03 最新证据；NF-04 候选迭代限制、四类错误分类及 20 秒工程预算超时均通过。为准备预算场景，隔离库中先真实完成 Tester／Developer 双角色构建；超时后 Tester 取消、Developer 未启动、worker 已停止。NF-04 及 TD-15 均未完整通过。详见 [TDD-044](TDD-044.md)。

TDD-045：在空白隔离 Compose 项目导入无密钥恢复包，重建需求确认后的 DevelopmentJob／候选，完成一次真实 Mock 设备查询并验证 App 重启后的恢复包持久性；目标容器与数据卷已删除。AC-18 三个分支已由固定 target 和受管执行报告通过；P0-A 当前 3/70 分支通过、67 项未验证，TD-15 仍未完成。详见 [TDD-045](TDD-045.md) 与 [工作区恢复证据](evidence/TD15-NF05-workspace.json)。

TDD-046：将真实 App／Runner SIGKILL 后未知写入核对及同一 Run 的快照／事件持久性分支接入统一平台 target 门禁；P0-A 更新为 5/70 分支通过、65 项未验证、0 项失败。Run 状态仍为 interrupted，业务 Run 验收保持失败；NF-01 双会话与刷新重连仍未验证。详见 [TDD-046](TDD-046.md)、[NF-01 故障证据](evidence/TD15-NF01-active-write-restart.json)、[重启持久性证据](evidence/TD15-NF01-restart-snapshot-events.json) 与 [P0-A 门禁报告](../../test-results/acceptance/P0-A-1792665380453.json)。

TDD-047：真实双角色生成 `tool-call-limit@1:3` 并在两个身份、独立 conversation 中交错执行；4 个 Run 各自恰好调用三次对应设备工具，跨身份复用 conversation 被拒绝。AC-17 与 NF-01 `two-sessions` 分支通过；P0-A 当前 7/70 分支通过、63 项未验证。详见 [TDD-047](TDD-047.md)、[双会话证据](evidence/TD15-NF01-two-sessions.json) 与 [P0-A 门禁报告](../../test-results/acceptance/P0-A-1792665812282.json)。

TDD-048：真实隔离 Docker Run 刷新与 SSE 断线重连通过；同一 Run 可恢复，游标续接事件无重复、无缺口，快照摘要不变。AC-13 三个分支与 NF-01 `refresh-reconnect` 接入固定目标受管证据。P0-A 当前 11/70 分支通过、59 项未验证、0 项失败；整体验收仍未完成。详见 [TDD-048](TDD-048.md)、[SSE 重连证据](evidence/TD15-NF01-sse-reconnect.json) 与 [P0-A 门禁报告](../../test-results/acceptance/P0-A-1792665920377.json)。

TDD-049：修复草稿列表移动端溢出和 Playwright 过时的项目恢复选择器；无模型时仍可保存并持久化草稿，有效快照启动被 `ENVIRONMENT_BLOCKED` 拒绝。新 App 镜像上重跑 NF-01 写后崩溃、重启持久性、双会话/Rail、SSE，以及 NF-05 新目录导入／重建／Mock 查询／重启恢复，均达到各自断言；NF-01 崩溃业务 Run 仍按 `interrupted` 记录，未误报成功。P0-A 当前 13/70 分支通过、57 项未验证、0 项失败。详见 [TDD-049](TDD-049.md)、[AC-01 证据](evidence/TD15-AC01-no-model.json) 和 [P0-A 门禁报告](../../test-results/acceptance/P0-A-1792667571504.json)。

TDD-050：固定隔离镜像上的真实浏览器验证覆盖 AC-02 问答／表单双向切换：字段值保留，编辑字段确认状态清除，未编辑字段确认状态保留，保存刷新后状态可恢复。两分支接入 P0-A 受管证据；当前 15/70 分支通过、55 项未验证、0 项失败。详见 [TDD-050](TDD-050.md)、[浏览器证据](evidence/TD15-AC02-mode-switch.json) 和 [P0-A 门禁报告](../../test-results/acceptance/P0-A-1792667687596.json)。

TDD-051：固定隔离镜像上对未知 Tool 与非法 Rail 参数执行真实 API 验收；两次均返回 `INVALID_ASSEMBLY`，未更改草稿或创建部分快照。非法 Rail 原因当前被分类为 `UNKNOWN_RAIL`，尚无专门参数错误码。AC-04 三分支接入受管证据；P0-A 当前 18/70 分支通过、52 项未验证、0 项失败。详见 [TDD-051](TDD-051.md)、[装配拒绝证据](evidence/TD15-AC04-invalid-assembly.json) 与 [P0-A 门禁报告](../../test-results/acceptance/P0-A-1792667756287.json)。

TDD-052：固定隔离镜像真实验证重复 Rail 与不支持 Agent 类型均返回 `INVALID_ASSEMBLY`，原因分别为 `CONFLICTING_RAILS`、`UNSUPPORTED_AGENT_TYPE`；原草稿不变且未生成快照。AC-06 两分支接入受管证据；P0-A 当前 20/70 分支通过、50 项未验证、0 项失败。详见 [TDD-052](TDD-052.md)、[冲突装配证据](evidence/TD15-AC06-incompatible-assembly.json) 与 [P0-A 门禁报告](../../test-results/acceptance/P0-A-1792667806324.json)。

TDD-053：固定隔离镜像上启用 `audit@1` 与 `tool-allowlist@1` 的 DeepAgent Run 成功；审计 Rail 记录实际设备调用，白名单 Rail 允许该 Tool，Mock 设备接口恰好调用一次。AC-05 两分支进入受管门禁；P0-A 当前 22/70 分支通过、48 项未验证、0 项失败。详见 [TDD-053](TDD-053.md)、[双 Rail 运行证据](evidence/TD15-AC05-two-rails-live.json) 与 [P0-A 门禁报告](../../test-results/acceptance/P0-A-1792667884802.json)。

TDD-054：按 TDD 完成 HTTP／MCP Tool 的版本化连接装配、受控 Run 上下文代理、Mock MCP 只读端点和双协议调用摘要事件。隔离 Docker 中 HTTP／MCP 真实 Run 均成功，外部设备查询各恰好一次且返回一致；HTTP/MCP 运行轨迹均记录版本、参数／结果摘要和耗时，MCP 另记录服务端版本。App 32 个测试文件／107 项单元与契约、Java Bridge 20 项、类型检查及 OpenCode 1.19.3 容器核验通过。当前目标镜像为 App `sha256:20f6bd053f086366dfc2d031221ea7ef507f3eb4`、Runner `sha256:70c8059b999db666be14a736e0d6db7606ed27a69a3ab24120e3249a99cc2ce0`。此项只关闭 AC-07；其他 P0-A/B/C 与 NF-01～06 仍需继续。详见 [TDD-054](TDD-054.md) 与 [AC-07 真实运行证据](evidence/TD15-AC07-http-mcp-live.json)。

TDD-055：在当前固定镜像重跑 AC-07、NF-01～NF-05 的相关真实场景，包含 NF-02 哨兵脱敏、NF-03 100 次保存／列表基准及 NF-04 限轮／超时／错误分类／容器日志轮转；修复汇总器和 manifest 映射。独立 P0-A 门禁当前 38/70 分支通过、32 未验证、0 失败。NF-04 容器日志轮转不等于业务 Run 事件 TTL 已验证；NF-01 写后崩溃场景的 Run 仍为 `interrupted`，只将安全断言记为通过。TD-15 尚未完成。详见 [TDD-055](TDD-055.md) 和 [P0-A 门禁报告](../../test-results/acceptance/P0-A-1792672448816.json)。

TDD-056：实现终态 Run 业务事件 90 天可配置保留、截断标记与数据库受控删除；真实 Docker 清理验证通过。NF-05 在新工作区完成项目包恢复、重新生成、部署及 Mock 冒烟，随后重启并清理临时栈。NF-01 当前固定镜像的八项工单用例完成；TC-008 因预期 SIGKILL 使 Run 中断，整体报告如实失败，但原幂等键核对、一次写入及零重复写入通过。补入 AC-08/09/10/11/12/14/16、AC-42a、EQ-03 与 EQ-02/read-timeout 后，P0-A 为 61/70 分支通过、9 未验证、0 失败。AC-15 的 Runner 中断探测只观测到 `VALIDATION_ENVIRONMENT_BLOCKED`，未计为实例启动失败通过。详见 [TDD-056](TDD-056.md) 与 [当前 P0-A 门禁报告](../../test-results/acceptance/P0-A-1792676918596.json)。

TDD-059：修复 Runner 任务取消与平台角色记录不一致：取消前观测到真实 OpenCode 进程，取消后进程消失；平台任务状态为 `cancelled`，Tester／Developer 均为 `skipped`，任务历史摘要保留。11 项相关测试、类型检查及 App 镜像的 110 项单元／契约测试通过。证据仅覆盖 AC-29a 的子进程取消分支和 NF-06 对应取消子项。当前 App 镜像已更新，旧 P0-A 报告绑定旧镜像，必须重跑；AC-29a 其他分支、NF-06 其余分支及 P0-B/P0-C 未完成。详见 [TDD-059](TDD-059.md) 与 [现场证据](evidence/TD15-NF06-cancel-child-process-live.json)。

TDD-060：修正验收清单中 AC-20 执行模式，将“模拟验证不得发布”关联到现有发布门禁测试并纳入受管证据。4 项发布门禁测试通过；当前固定镜像下 P0-A 报告为 66/70 分支通过、4 未验证、0 失败，整体仍为未验证。未验证项是 AC-15、AC-19 两个取消／未知写入分支和尚无检索接口的 EQ-01。详见 [TDD-060](TDD-060.md)、[门禁测试输出](evidence/TD15-AC20-simulation-not-publishable.test.log) 与 [P0-A 报告](../../test-results/acceptance/P0-A-1792680142612.json)。

TDD-061：发布 worker 现在会在调用 Runner 前持久化 `preparing`，Runner 连接失败／超时保存安全诊断码。发布与 HTTP 依赖集成测试 12 项通过。AC-15 在当前 App `sha256:0af8273c2e56012c4e8adb04d36b3ed7f783d97784ef0b7a41eb7af735c2aba4`／Runner `sha256:70c8059b999db666be14a736e0d6db7606ed27a69a3ab24120e3249a99cc2ce0` 上通过：新基线完整通过后建立兼容 v1，下一部署启动失败且指针不变，Runner 恢复后当前版本只读 Run 成功。AC-19 旧证据绑定上一 App 镜像，需重跑。详见 [TDD-061](TDD-061.md) 与 [AC-15 证据](evidence/TD15-AC15-startup-failure-live.json)。

TDD-062：增加版本化维护资料 Mock 检索接口、只读 Tool 与固定会话代理，并在组件目录开放装配。22 项相关单元／集成测试、全项目类型检查和 Docker App 构建（114 项单元／契约测试）通过。EQ-01 真实 Run 证明空检索结果不会生成来源或维修结论。AC-15 当前镜像复验通过；AC-19 和其他旧目标证据需重跑后才能汇总门禁。详见 [TDD-062](TDD-062.md)、[EQ-01 证据](evidence/TD15-EQ01-empty-retrieval-live.json) 与 [AC-15 证据](evidence/TD15-AC15-startup-failure-live.json)。

TDD-063：重建并固定最终 App／Runner 镜像。类型检查、33 个测试文件共 114 项单元／契约测试及生产构建通过；刷新 P0-A 现场证据后，独立 P0-A 门禁 29 项／70 分支通过。当前同目标下 P0-B 尚有 98 个分支、P0-C 尚有 161 个分支未验证。为确保重跑可复用，修复 AC-16 固定 revision 断言，调整 NF-05 隔离端口断言；NF-05 项目导出、无凭据恢复、重新生成候选、部署、Mock 冒烟及 App 重启后恢复包检查通过。详见 [TDD-063](TDD-063.md)、[最终 P0-A 报告](../../test-results/acceptance/P0-A-1792687317226.json)、[P0-B 报告](../../test-results/acceptance/P0-B-1792687341587.json) 和 [P0-C 报告](../../test-results/acceptance/P0-C-1792687323990.json)。

TDD-064：最终固定镜像上，AC-21 与 AC-22a/b 的 8 个分支通过：Tester／Developer 独立会话共享确认基线，测试先红后绿，生成 Tool、Skill、Rail 和 JAR，并经候选测试部署真实调用 Mock 设备接口。另复验工程任务取消：OpenCode 子进程退出且任务历史保留，将 AC-29a 取消／历史分支与 NF-06 取消分支纳入门禁。当前 P0-A 为 70/70 分支通过；P0-B 为 81 通过、87 未验证、0 失败；P0-C 为 81 通过、150 未验证、0 失败，TD-15 全量验收尚未完成。详见 [TDD-064](TDD-064.md)、[生成运行证据](evidence/TD15-AC21-AC22-generation-live.json)、[取消证据](evidence/TD15-NF06-cancel-child-process-live.json) 和对应门禁报告。

验收分项校正：AC-22c 对应 Agent 源码、构建与真实任务；AC-22d 对应 Rail 生成定义、Hook 装载和调用边界。当前只通过 AC-22a/b（Tool／Skill），不能将本轮生成 Tool／Skill／Rail 的混合产物计作独立 Agent 或 Rail 端到端通过。后续优先实现 AC-22c 的可审阅 Agent 工程产物，再补 AC-22d 的隔离状态与限额边界实测。

TDD-066：修复受限生成请求被拒绝后无历史记录的问题。现在错误 scope、依赖、profile 与业务连接在绑定快照／基线后形成终态失败任务及 `policy.rejected` 事件；相同请求幂等返回原记录，Runner 不会收到任务。四类请求在新 App 镜像隔离栈的 API 冒烟通过；新镜像内 114 项单元／契约测试通过，17 个集成文件／105 项通过，类型检查和生产构建通过。新 App 镜像为 `sha256:ab65d4b6a5e6406c49c7d699207b6be63269b76f1f2b42debe3a140ca4d46561`，已更新主 TD-15 栈，18080 健康检查返回 200；旧 P0-A/B/C 报告绑定前一镜像，不能代表新目标。AC-23 文件路径及命令越权分支仍待独立现场验证；完整回归需在新目标上刷新。详见 [TDD-066](TDD-066.md) 与 [AC-23 策略拒绝证据](evidence/TD15-AC23-policy-audit-live.json)。

TDD-067：在固定 App／Runner 镜像上刷新 AC-15、AC-16、AC-19、AC-21/22、EQ-01 及 NF-01/02/03/04 等证据；AC-02/03 浏览器用例通过 2 项。全量 E2E 曾有 2 通过、5 失败、9 跳过；已修正阶段页签／项目选择、基线确认、Tool／Skill／Rail 范围和契约数断言，类型检查及 114 项单测／契约测试通过；Edge + 临时 Vite + API 夹具下 3 项 UI E2E 通过，不代表全栈回归。AC-19 取消未知写入最终为 cancelled，Mock 写调用为 1；EQ-01 空检索未编造来源或维修结论。证据汇总现卡在 NF-05 目标镜像证据：C 盘目前有约 6.2 GiB 可用，但 Docker Desktop Service `com.docker.service` 仍停止，启动服务因权限不足失败，Docker socket `/ _ping` 超时。用户授权删除的 VS／Windows SDK 暂存目录删除命令被本机策略拒绝，未删除。最终受管验收包及新 P0-A/B/C 未生成，TD-15 全量验收未完成；需由具备权限的本机操作员启动 Docker Desktop Service 后，检查 NF-05 项目残留并重跑 NF-05、剩余目标绑定及完整浏览器回归。详见 [TDD-067](TDD-067.md)。

TDD-068：Docker 数据迁移后，主栈已恢复并在固定 App／Runner 镜像上完成真实 DeepSeek 工单全链路复验。TC-001～TC-008 全部通过；同一候选发布成功，模拟 App 批准前 Mock 工单写调用为 0，批准后为 1，外部工单数为 1；类型检查及发布恢复 E2E 通过。刷新门禁后 P0-A 为 70/70；P0-B 为 81/170、P0-C 为 86/235，其余分支未验证。TDD-067 的 Docker 停止描述仅是历史快照，现已被迁移后现场核验取代。金融 Tool／Skill 自动生成及运行、金融申购异常场景和剩余 P0-B/P0-C 仍未完成，TD-15 保持未完成。详见 [TDD-068](TDD-068.md)。

TDD-069：登记受限的 `wealth-balance-java@1` 规格，并让 Server 与 Runner 共用生成能力就绪门禁：设备 Profile 保持可执行；金融余额 Profile 在专属生成模板和运行链路交付前明确拒绝，避免被设备模板误处理。先红后绿；33 个单元／契约测试共 116 项、DevelopmentService 集成测试 6 项、Java Bridge 20 项通过，类型检查与 App／Runner Docker 构建通过。新镜像已部署到主栈与 NF-01；现场金融 Profile 请求被拒绝且 Runner 未收到任务。更新 NF-01 镜像后证据装配器拒绝旧目标绑定；P0-A/B/C 需要在新镜像上刷新，金融生成与运行仍未实现。TD-15 保持未完成。详见 [TDD-069](TDD-069.md) 和 [金融 Profile 现场门禁](evidence/TDD-069/finance-profile-gate-live.json)。

TDD-070：在 TDD-069 镜像上刷新 86 条已实现分支证据并重建平台验收包。NF-01 写后崩溃对账、AC-15 启动失败保留旧发布、AC-16 回滚、AC-19 取消与未知写入、双会话／SSE、HTTP／MCP、AC-21/22 真实双角色 Tool／Skill／Rail 生成、AC-18 新目录恢复及 NF-02～06 相关场景已在当前镜像通过；AC-12 故障后 Run 保持 `interrupted`，不伪报业务成功。P0-A 最新报告为 70/70；P0-B 81/170、P0-C 86/235，分别仍有 89 与 149 项未验证，主要包含未实现的金融 App／业务回归、独立生成任务以及实例隔离、重置、版本并行等验收。33 个测试文件／116 项单元和契约测试、类型检查、`git diff --check` 通过。修复四个现场验证脚本直接导入 TypeScript 源码导致的 Node 模块解析失败；NF-05 Compose 故障现在保留 stderr 诊断。TD-15 保持未完成。详见 [TDD-070](TDD-070.md)。

TDD-071：为固定 HTTP Tool 代理新增 `getAccountBalance` 余额读取入口，使用 JSON Schema 限定 `accountId`，并验证操作绑定、可信 Run／环境／actor 上下文和越权字段拒绝。真实 Mock HTTP／PostgreSQL 集成中的 10 项测试通过，`HttpMock` 查询到 A1001 种子余额并在审计记录中保留 Run 与 actor；代理 6 项测试通过。集成项目因独立数据库 schema 初始化实测约需 74 秒，将该项目测试与钩子时限设为 90 秒。当前 `corepack pnpm test` 为 33 个文件／120 项通过，类型检查和 `git diff --check` 通过。本批尚未实现余额 Tool／Skill 生成、候选运行或模拟 APP，也未部署新镜像；AC-22a/b、AC-31/32、金融 TC-001a～TC-007f 及 P0-B/C 剩余分支仍未完成。详见 [TDD-071](TDD-071.md)。

TDD-065：加强固定模板 Rail 的确定性 SDK 集成验证，同一会话连续 Run 请求 2／3／4 次 Tool，覆盖上限以下、达到 3 次及超限第 4 次被阻断；最终固定镜像生成的 Rail 在真实候选 Run 中装载，记录 1、2 两次放行事件并绑定 Run 会话。AC-22d 五个运行／产物分支进入门禁。为贴合 PRD“分别提出生成任务”，AC-22a/b/c/d 新增独立生成请求分支；混合请求不能关闭这些分支，当前仍未验证。P0-A 70 通过；P0-B 81 通过、89 未验证；P0-C 86 通过、149 未验证，均为 0 失败。详见 [TDD-065](TDD-065.md) 与对应门禁报告。

TDD-072：将生成制品清单从设备 Tool／Skill 专属字段扩展为受摘要保护的类名、Tool 名、operationId 与 Skill 名／路径，并在 Runner 归档检查、候选 Skill 摘要校验、Java Bridge 类装载和 Skill Rail 中使用同一绑定；旧设备清单保持兼容。金融 `AccountBalanceTool`／`balance-query` 动态装载测试先红后绿。Java Bridge 7 个测试类／21 项、Runner 归档 3 项、单元／契约 33 个文件／120 项、类型检查及 `git diff --check` 通过。本批只验证通用金融形态 fixture；Runner 生成工作区和 Bundle 校验仍设备专属，未生成或部署金融候选，TD-15 未完成。详见 [TDD-072](TDD-072.md)。

TDD-080：按 TDD 修正 AC-26 暴露的验收误判：只读工具超时后助手如实说明“无法确认状态／温度／来源”，旧断言因强制未定义的 `tool-error` JSON 格式而失败。新断言核对实际业务值是否泄露，结构化错误格式仍校验错误码和消息；设备、工单、余额基线规则版本升版并拒绝旧版新验收。新增回归先红后绿；断言／基线测试 20 项、完整单元／契约 130 项、类型检查通过。首次 Docker 构建发现项目导入 Schema 未接纳新版本，修复后内置 35 文件／130 测试、Web/Server/Runner 构建均通过。新 NF-01 App／Runner 镜像上 AC-23 与 AC-26 通过；AC-26 在一次修复后完成固定三项回归、发布和真实业务调用。此前 D 盘迁移仅移动镜像存储，没有重建镜像；若摘要与运行配置不变，不因迁移重复功能检验。之后 TDD-080 修改并重建 App／Runner，导致受影响的旧 NF-01 证据需按新目标刷新，不能把这项工作归因于迁移；受管验收包及 P0-A/B/C 汇总尚待完成，TD-15 未完成。详见 [TDD-080](TDD-080.md)、[验收断言证据](evidence/TDD-080-acceptance-no-facts-and-docker-refresh.json)、[AC-23](evidence/TD15-AC23-policy-audit-live.json) 和 [AC-26](evidence/TD15-AC26-docker-live.json)。

TDD-084：本地 AC-15 现场复验发现 Runner 顺序恢复 21 个持久部署需约 195 秒；原 180 秒脚本限时导致误报失败，Runner 随后自行健康。恢复窗口现可通过 `TD15_AC15_RUNNER_RECOVERY_TIMEOUT_MS` 配置，默认 360 秒。复用同目标上已通过的八场景验证后重跑：Runner 停止时发布失败且旧指针不变，Runner 195174 ms 恢复，旧版本只读 Run 成功，AC-15 通过。首轮失败尝试保留供追溯。TD-15 其他需求和门禁仍待验证。详见 [TDD-084](TDD-084.md) 与 [AC-15 现场证据](evidence/TD15-AC15-startup-failure-live.json)。

TDD-086：在固定本地镜像上由 Tester／Developer 双角色从空业务组件选择生成余额查询 Tool 与 Skill，完成测试先红后绿、契约检查、候选构建及三条 live-mock 场景；覆盖真实余额、缺字段零调用和 Tool 超时不编造事实。AC-31 两个分支通过；P0-A 70/70，P0-B 98/170，P0-C 103/235。此闭环只证明余额 Tool／Skill，不代表产品查询、申购、Rail 生成或手机 App 发布通过。详见 [TDD-086](TDD-086.md)。

TDD-087：核对并复用与当前 NF-01 App／Runner 镜像一致的 AC-26 真实修复证据，无需重复执行昂贵的模型修复和发布。将原缺陷、独立新候选、同一断言回归、失败历史保留 4 个分支纳入受管结果，并登记现场验证脚本。当前 P0-A 70/70；P0-B 102/170、68 未验证；P0-C 107/235、128 未验证，均无硬失败。TD-15 仍未完成。详见 [TDD-087](TDD-087.md) 与 [当前验收证据](evidence/TD15-20261024-P0-B.json)。

TDD-088：在与 NF-01 固定镜像相同的隔离 Compose 栈中验证 AC-29a 预算到期与 App／Runner 重启不重放。30 秒预算期间观察到实际 OpenCode 子进程；预算结束后执行器以 `ENGINEERING_BUDGET_EXCEEDED` 终止任务并清理子进程，未生成候选。重启后任务失败状态、输入摘要和事件记录保持稳定，未重放子进程。证据采集后清理隔离栈，NF-01 主栈保持健康。当前 P0-A 70/70；P0-B 104/170、66 未验证；P0-C 109/235、126 未验证，均无硬失败。TD-15 仍未完成。详见 [TDD-088](TDD-088.md) 与 [AC-29a 现场证据](evidence/TD15-AC29a-budget-restart-live.json)。
