# 原生 DeepAgent Skill 执行

当前联调主线：`moa_agent` 工程的 `phoenix` 分支。方案来自 `feature/deepagent-skills`
（基线 `6d3a83f`，原生执行提交 `edfc1ae`），并包含随后整理的资产目录说明。
旧 Skill/Flow Engine 在 `feature/skill-engine-reference`（`c5f2123`）保留；
当前实现不依赖其代码或同级旧参考工程。

## 1. 当前架构

```text
L1 阶段规划（一个父 todo）
  → LocalExecutionRequest → LocalAgentDelegate.start（kind=SKILL，直接 Java 方法调用）
  → 进程内 Skill DeepAgent（不注册服务、不监听端口）
      入口 SKILL.md 固定加载
      原生 SkillUseRail 展示目录，read_file 按需读取业务 Skill
      原生模型工具循环选择下一步
      ask_user → Core 检查点 → runtime 中断 → 原任务恢复
      call_versatile → runtime A2A → L2 → 结果契约校验（可选脚本归一化）
      call_mcp → 授权脚本 → 沙箱内自行调用 MCP
      terminal operation 成功且结果通过校验 → 执行运行时完成 Skill → L1 父 todo 结束

完成语义由 operation 数据推导：存在 `terminal: true` 的授权 operation 时，执行引擎在该 operation 成功且结果通过后台契约校验后直接完成 Skill，模型不需要也不能调用额外的完成工具；没有 terminal operation 时，各操作成功后继续 agent-loop，由模型按完整请求决定下一步。没有待处理工作、确认或中断时允许自然结束，不要求必须调用 operation；仅说明或回答也可直接返回自然文本。
```

没有 Flow 节点图、自建模型循环、Skill 子状态机或额外执行内核 JAR。
`SkillSession` 仅保存业务结果、调用收据、确认凭据和父任务信息；工具中断与消息恢复由 Core 负责。
不同 Agent ID 与执行级会话隔离检查点数据；一次执行中的多个 Skill 共用一个 Skill Agent 会话。

当前只发布 `moa-agent` 一个 JAR、启动一个应用上下文，只托管 runtime 原生 `JiuwenCoreAgentExtHandler`，默认端口 18098。
部署需启用 `openjiuwen.service.agentcore.request-context.enabled=true`，由 runtime 为每次请求提供上下文快照。
`LocalDelegationRail` 仅处理父子中断标识；请求原文和 metadata 由 `RequestContextAccessor` 按需读取；`SkillActionRail` 仅按操作声明绑定 metadata，
Custom REST 适配层过滤主模型原始增量。MOA 不再继承或装饰 Handler。
开启本地 Skill 不改变主服务的端口、Agent ID 或 AgentCard。
本地执行没有新增 runtime 中断类型、HTTP/A2A 服务或供模型任意调用的工具。
启动使用普通 `LocalExecutionRequest`，不构造伪委派 `InterruptRequest`，也不要求 runtime 捕获本地启动动作。
只有已授权的 SKILL 候选可进入本地执行器；AGENT/WORKFLOW 仍走原有远端 `a2a_delegate`。

### 本地中断与续接

- `LocalSkillDelegate` 在执行时创建原生 DeepAgent 对象，直接通过 Core Runner 驱动，不经过回环 HTTP。
- `ExecutionEngine.prepareLocal` 校验候选授权并构造启动请求，`startLocal`/`resumeLocal` 分别调用本地执行器的
  `start`/`resume`。请求承载目标、能力、query、原有 intent、父 todo、计划版本和稳定执行标识；
  `native_skill_v1` 输入协议仅在 Skill 执行器边界组装，现有 Markdown 和脚本无需修改。
- 本地返回值 `Step` 只能是完成结果或真实中断之一；只有子 Agent 的问询、确认、远端 `a2a_delegate`
  需要向主 runtime 传播中断。本地启动本身不是中断，启动和续接也不再通过空参数组合表达。
- 每个父 todo 使用稳定的执行标识，派生独立的子 Agent ID 和子会话 ID。每轮对象用完即关闭，
  释放回调、工具和调度器；后续请求以相同身份从 Core 检查点恢复，不重新开始 Skill。
- 父计划保存父工具调用与子待响应调用的映射。子 `ask_user`、确认或远端 L2 等待时，父 todo 保持 RUNNING。
  新回复先还原子调用标识；远端最终结果进入子 Skill 的处理器，而不是直接完成父 todo。
- 本地委派外部中断 ID 带 `moa-local-skill--` 前缀，并编码父/子调用 ID；恢复时校验子调用是否仍在等待。
  本地待执行信息保存在父会话检查点，不依赖进程内会话路由 Map。
- 子 DeepAgent 的 `call_versatile` 仍产生原生远端 `a2a_delegate`；部署的 adapter、intent、业务脚本接口不变。
- 主请求的受信任 metadata 通过 request-scoped env 传入子会话，再由操作的 metadata-bindings 按需提取。
- 子执行有合法终结结果才结束父 todo；异常、未验证结果与意图切换按失败/blocked 处理，禁止自动重跑交易。
  已完成子执行释放其检查点；未完成会话的持久性与过期策略仍取决于运行时使用的 Core checkpointer。

## 2. 资产与配置

业务资产是独立目录：

```text
assets/
  entry/SKILL.md
  product_recommend_skill/SKILL.md
  interact_finance_rec_skill/SKILL.md
  product_select_skill/SKILL.md
  fund_planning_skill/SKILL.md
  contracts/                       宿主加载的 input/result/summary 契约
  scripts/                         可选后台实现，也可保存在各 Skill 子目录
```

不要求 `execution.yaml`、`flow.yaml`、`skill-pack.yaml`、`skill-chain-pack.yaml`。
宿主的 `moa.skill-agent.operations`（多定义时为 `definitions.<id>.operations`）是静态工具授权，不是另一个工作流：它声明固定目标、脚本、
数据契约及预算；可通过 next-operation 固定衔接无需模型决策的内部步骤，但不描述完整业务流程图。
动态资源加卸载不属于本版。Markdown、脚本及契约在启动时读取；更新资产应重启并使用新会话，不支持运行中迁移历史任务。
原有资产源目录不修改。本地查看副本统一放在工程内 `assets/edp/`，该目录由 Git 忽略，
并位于 Maven 默认资源目录之外，不随 JAR 打包：

```text
assets/edp/
  README.md                         本地来源、状态和适配清单
  config/skill-local.example.yml     本地八个业务操作配置，部署时补齐环境值
  reference/AgentRule.md             原业务规则，供迁移对照，不作为 Skill 加载
  reference/original-skills/         迁移前资产副本，不加载
  skills/
    contracts/                       独立 operation 契约：input/result/summary
    entry/SKILL.md                   新宿主入口说明
    product_recommend_skill/SKILL.md  业务说明
    interact_finance_rec_skill/SKILL.md
    product_select_skill/SKILL.md
    fund_planning_skill/SKILL.md
    <业务 Skill>/scripts/            宿主绑定的可选后台实现
  tests/                            本地资产契约测试
```

本地四个业务 Skill、Python 和部署配置已迁移至新宿主协议，完成离线契约验证；
真实模型、沙箱和业务服务联调尚未完成。`SKILL_ASSET_ROOT` 应指向
`assets/edp/skills` 的绝对路径，`SKILL_ENTRY=entry`；不要将整个 `assets/edp` 作为根目录，
以免把配置和参考资料也纳入模型可读取范围。Git clone 不包含这些本地业务资产。
运行资产不再依赖旧 AgentRule 字段：流程规则归 Skill，操作授权与预算归配置，话术归处理器的
message 和原生交互工具。协议适配主要在资产脚本完成，原则上不要求下游 A2A/MCP 改接口；
实际路由、字段映射和缺失业务事实仍需联调确认。可提交的 docs/examples 仍是精简接口示例，
不是本地独立业务包的重复副本。
`SKILL.md` 只描述业务目标、用户交互及授权 operation，不说明 Python 文件、命令或脚本实现。
脚本路径由宿主配置注册，模型不能读取或改写；维护说明应放在不加载到模型的部署文档中。
脚本可归属于各业务 Skill 或集中存放；单文件执行不会自动上传同目录依赖，当前不使用跨脚本 import。

入口必须有 `name / description` frontmatter，并明确后续 Skill 的使用条件。所有模型工具调用使用新接口，
原 EDP Markdown 不能不加调整直接运行：

| 工具 | 模型参数 | 行为 |
| --- | --- | --- |
| `read_file` | `file_path` | 只读已加载 Markdown，禁止任意磁盘读取 |
| `call_versatile` | `operation, arguments` | 固定 adapter/intent 的 A2A；可选脚本归一化，统一校验后台结果并返回公开摘要 |
| `call_mcp` | `operation, arguments` | 运行静态授权 Python；MCP SDK、服务器及参数差异归脚本 |
| `ask_user` | 原生 `questions` | 原生交互中断，不是交易授权 |
| `confirm_action` | `operation, arguments` | 确认指定操作、精确参数和当前业务结果版本 |
| `skill_results` | 空对象或 `operation` | 空对象只列公开操作的版本与引用；指定操作只返回公开摘要，不读取后台 results |
| `cancel_skill` | 空对象 | 二次确认取消；已发生的业务不回滚 |

`confirm_action` 和 `cancel_skill` 的当前确认中断共用明确肯定词：确认、确认执行、确定、是、好、好的、同意、ok、yes。
忽略两端空白及英文大小写，仍要求整句匹配；“不好”“好的但改成200元”“ok?”不会授权。
这些词不用于候选选择，也不改写 L2 接管后的用户答复；Skill 仍校验确认对应的操作、精确参数和结果版本。

确认回答由确定性规则匹配，不使用模型替用户产生授权。
确认中断的输入 Schema 仅声明字符串类型，不下发确认词枚举或正则；支持词由后端统一识别，前端仍只展示简短提示和确认／拒绝选项。
风险操作必须在部署授权中设置 `confirmation-required: true`。`terminal` 标记整体任务的终结操作，
不表示高风险；查询类任务也可以 terminal。宿主部署者负责正确标记具有副作用的操作。
`terminal: true` 表示该操作成功后立即结束整个 Skill，适用于操作本身就是整体完成点的业务；不是“该步骤必须校验”的开关，所有操作都会校验结果。声明 terminal operation 后，模型自然结束会失败，成功结果由执行引擎直接结束 Skill。可复用的多步操作应全部设为 `terminal: false`，由 agent-loop 完成剩余请求后自然结束；没有 operation 的 Markdown-only Skill 也无需伪造空的 `result-script`。YAML 中的空 properties/required 及索引形式列表
在加载时统一归一化，运行时仍拒绝缺少必填字段或携带额外字段的输入。
只在整体业务完成点标记 terminal；例如“转账后购买”中的转账不是终结操作，不能因转账成功提前结束任务。
完成要求目前按本次执行的授权 operation 集合推导，不按每份 SKILL.md 单独切换。
无 terminal 的 Skill 自然结束时，内部终态使用 `status=completed/completion_reason=natural_end`。
有模型正文时原样返回正文，不因配置了 operation 就要求存在执行回执。
若已执行操作，则从执行轨道已校验并保存的工具回执附带汇总，不重复校验业务契约：
内部 `completed_operations` 按版本保留每次已完成调用，包括重复操作；`data` 为最后一次公开回执。
模型无正文但有已完成回执时，输出 `completed_operations`，每项仅包含 operation 和 summary；
内部协议、执行版本和引用不进入对外正文。模型既无正文也无回执，或仍有 pending/approval 时，自然结束会失败。
纯模型回答不等同于业务操作成功凭据。后台完整结果、内部步骤和确认回执不进入此汇总。
步骤是否覆盖完整业务目标由模型依据 Skill 与用户请求判断；框架只汇总实际完成的步骤，不从自然语言猜测执行结果。
L1 的高风险计划确认只批准进入组合任务，不代替 Skill 内后续才确定的具体操作、金额等参数确认。

## 3. 配置和启动

先构建：`mvn clean package`。

L1：`java -jar target/moa-agent-0.1.0.jar`。

启用本地 Skill 的主 MOA（只需启动这一条进程）：

```shell
java -jar target/moa-agent-0.1.0.jar --moa.skill-agent.enabled=true --spring.config.additional-location=file:./skill-local.yml
```

官方应用的 `application.yml` 使用平铺的单定义配置；默认不启用、不预置业务资产。
业务以外部 YAML 覆盖 `moa.skill-agent.root/entry/operations`，无需增加 `definitions` 层。
正式业务可使用 `SKILL_AGENT_ENABLED=true` 或外部配置 `moa.skill-agent.enabled=true`。
已移除 `SKILL_AGENT_PORT`、Skill 服务 AgentCard 和 `moa.mode=skill`；主 L1 仍默认使用 18098。
`moa.skill-agent.agent-id` 是本地子 Agent 的定义 ID，不能与主 Agent ID 相同；不是对外服务身份。
单定义会自动转换为该 ID 对应的内部定义；`SKILL_AGENT_ID`、`SKILL_AGENT_WORKSPACE`、
`SKILL_ASSET_ROOT`、`SKILL_ENTRY` 仍可覆盖配置。多个资源包可改用 `definitions`，但不可混用。
启用 Skill 后要求配置资产；operation 和 terminal 均非所有 Skill 必需。当前默认脚本运行器仍要求 SESSION 隔离沙箱，不回落到本机 Python/bash。
官方 `application.yml` 已通过 Runtime 的 `openjiuwen.service.external.sandbox` 提供 SESSION
隔离沙箱的示例连接配置：`http://127.0.0.1:8321`、`launcher-type=pre_deploy`、
`sandbox-type=jiuwenbox`。这只是客户端配置，不会自动启动沙箱服务或启用 Skill。
MOA 只通过 `moa.skill-agent.sandbox-server-id` 引用 Runtime 已注册的 Sandbox，默认引用 `default`。
地址、超时、启动器、沙箱类型和生命周期等连接参数统一由 Runtime 管理，可用
`OPENJIUWEN_SANDBOX_ENABLED`、`OPENJIUWEN_SANDBOX_TIMEOUT_MS`、`OPENJIUWEN_SANDBOX_SERVER_ID`、
`OPENJIUWEN_SANDBOX_SERVICE_URL`、`OPENJIUWEN_SANDBOX_TYPE`、`OPENJIUWEN_SANDBOX_LAUNCHER_TYPE`、
`OPENJIUWEN_SANDBOX_ON_STOP`、`OPENJIUWEN_SANDBOX_ROOT_PATH` 覆盖。
实际使用其他沙箱类型时须按 Runtime 的部署参数配置，真实沙箱的认证参数也应在 Runtime 外部配置提供。
通用配置样例见 `docs/examples/native-skill/skill-local.yml`；入口转换说明见同目录 `entry/SKILL.md`。
该示例仅展示接口契约，不是已连接生产理财工作流的业务包。

### Linux 相对路径、软链接与资产加载诊断

`spring.config.additional-location` 定位的是 Spring 配置文件，不是 Skill 资产根目录。
Skill 资产根目录由 `moa.skill-agent.root`（本地 EDP 示例引用 `SKILL_ASSET_ROOT`）决定。
两者的相对路径均以进程工作目录为基准，不以 JAR 文件所在目录或额外 YAML 所在目录为基准。

`SkillAssets` 在加载前已对 root 调用 `toRealPath()`，因此部署目录或整个资产根目录是软链接时，
无需手工将 additional-location 改成 realpath；这种修改也不能修复缺失脚本或 root 配置错误。
可从部署根目录启动，继续使用稳定的相对配置和相对于 Skill root 的脚本路径：

```bash
export SKILL_ASSET_ROOT=./assets/edp/skills
java -jar target/moa-demo-0.1.0.jar \
  --spring.profiles.active=demo \
  --spring.config.additional-location=file:./assets/edp/config/skill-local.example.yml
```

也可以用 `--moa.skill-agent.root=./assets/edp/skills` 显式覆盖属性。
若由 systemd 启动，设置部署根目录为 `WorkingDirectory`，而不是依赖登录 shell 的当前位置。
root 应包含 `entry/SKILL.md` 及配置中引用的各 Skill 脚本，不能指向 `assets/edp` 或 `assets/edp/config`。

EDP 业务资产由独立 moa_demo 仓库管理且不在 JAR 中，另一台服务器需单独分发与配置匹配的资产；只复制 JAR 不足以启用 Skill。
出现 `localSkillDelegate` 工厂方法报错时，查看完整 `Caused by`：
- `Skill 入口加载失败`：包含 configuredRoot、realRoot、entry，检查入口文件部署位置和 `SKILL.md` 大小写。
- `Skill 操作脚本校验失败`：包含 operation、field、resource、realRoot，可直接定位哪项 before-script/result-script 配置失效。
- `reason=not_loaded`：不在启动时加载的资产快照中，检查缺失/旧路径、大小写、8 层扫描深度以及目录软链接。
- `reason=outside_root`：请求路径不在规范化根目录下，不应通过放宽白名单解决。

当前加载根目录下 `.md` / `.py` / `.yml` / `.yaml` / `.json` 并保持启动快照；模型 read_file 仅允许读取 Markdown，不递归跟随资产内部的目录软链接。
因此“部署根目录是软链接”与“entry 或某个 Skill 子目录是软链接”不同：后者不会自动被扫描。
可将 root 指向完整资产树的真实根目录（该 root 本身仍可是软链接），或在发布时展开各 Skill 子目录；
不要把越界软链接当作授权资源，也不要把 scripts 改成机器相关的绝对路径。

Linux 上可先做只读检查（从与服务相同的工作目录执行）：

```bash
pwd -P
printf 'SKILL_ASSET_ROOT=%s\n' "${SKILL_ASSET_ROOT-}"
readlink -f "${SKILL_ASSET_ROOT:-./assets/edp/skills}"
ls -l "${SKILL_ASSET_ROOT:-./assets/edp/skills}/entry/SKILL.md"
find -H "${SKILL_ASSET_ROOT:-./assets/edp/skills}" -type l -print
```

上述诊断仅显示部署路径和操作标识，不打印脚本内容、用户报文或 metadata。完整配置仍可能含凭据，请勿直接贴出。

也可以不使用 profile，在额外配置中启用：

```yaml
moa:
  skill-agent:
    enabled: true
    # 同时加载声明本地 Skill 及其授权操作的业务资源配置。
```

通用业务部署可以在已有候选包中追加一个组合入口候选，不另建技能链候选包。

```yaml
id: cap.skill.finance
name: 理财组合办理
description: 按需求推荐产品、交互筛选、选择金额并进行资金筹划与购买
kind: SKILL
risk: HIGH
utterances: [帮我推荐并购买理财]
keywords: [推荐, 理财, 购买]
versatile: {adapter: skill-agent, intent: 理财组合办理}
```

资产本身不会自动覆盖现有意图服务结果；通过 `IntentCandidateResolver` 将召回意图绑定到目录中的 Skill 候选。
业务 SPI 的配置、边界和扩展示例见 [意图候选解析扩展](intent-candidate-resolver.md)。
候选的 adapter 必须等于 `moa.skill-agent.agent-id`；多定义时必须等于 `definitions` 中的一个定义 ID，否则拒绝执行。
不要在 `openjiuwen.service.a2a.remote-agents` 注册 skill-agent，也不再设置 `moa.skill-delegation.adapters`。
远端列表只保留实际的 L2 服务；建议开启其 streaming，以承接执行期间的表单、认证与输入提示。

## 4. 脚本、metadata 与结果

### 业务步骤失败与 A2A 委派定位

若 A2A 客户端报告 `NoClassDefFoundError: com/google/protobuf/RuntimeVersion$RuntimeDomain`，
这是 Protobuf 运行库与 A2A SDK 生成代码不兼容，不是 IntentCandidateResolver SPI 或 AutoConfiguration.imports 的发现问题。
已在本工程依赖树中复现：core → Milvus 带入 protobuf-java 3.25.5，覆盖 A2A SDK 1.0.0.Final 要求的 4.33.2。
JSONRPCTransport 的请求映射也会初始化 protobuf 生成类，使用 JSON-RPC 并不表示不依赖 Protobuf。
MOA 的 dependencyManagement 统一锁定 protobuf-java / protobuf-java-util 为 4.33.2；
仅依赖 agent-service-app 自身的依赖管理，不会自动统一消费工程所有分支的版本。

构建与部署前验证：

```bash
mvn dependency:tree -Dverbose '-Dincludes=com.google.protobuf:*'
mvn -Dtest=A2AProtobufCompatibilityTest,NativeSkillHttpIT clean package
jar tf target/moa-agent-0.1.0.jar | grep 'BOOT-INF/lib/protobuf-'
```

确认打包的 protobuf-java 与 protobuf-java-util 均为 4.33.2，再替换服务器 JAR 并重启进程。
不要在旧运行进程中补 JAR，也不要同时放入 3.x / 4.x 两个版本。
回归测试直接初始化 SendMessageRequest，并验证二进制和 JSON 编解码；无须模型、沙箱或实际 L2 即可发现该链接错误。
这里修复的是当前版本组合；更换 A2A SDK 时需同步检查生成代码要求与最终依赖树。

`call_versatile` 不要求模型再发起一次名为 `a2a_delegate` 的工具调用：SkillActionRail 产生
`_interrupt_kind=a2a_delegate` 中断，LocalSkillDelegate 转交父 Agent，最终由主 runtime 发起远程调用。
所以“模型工具列表里没有 a2a_delegate”不代表没有调用 L2。

`todo_start` 与“正在执行”话术在前置脚本通过之后、提交委派之前发出，不能作为远端收到请求的证明。
`BUSINESS_EXECUTION_FAILED` 表示已登记的步骤失败，不代表故障必定位于模型或 A2A 之前。
失败结果保留该 reason，并增加安全的 `operation` 与 `stage` 定位字段，不附带原始响应。

按 execution / call 标识串联日志：

| 日志阶段 | 能确认的事实 |
| --- | --- |
| `[SKILL-ACTION] stage=before_script` | 正在运行前置脚本；失败时尚未进入委派 |
| `stage=prepare_delegate action=reject` | 构造请求失败，如模板引用了未提供的参数 |
| `stage=delegate_requested` | 已构造带固定 adapter/intent 的 A2A 中断，尚不代表 HTTP 请求成功 |
| `[MOA-LOCAL-DELEGATE] action=forward_interrupt kind=a2a_delegate` | 本地子 Agent 中断已交回父 Agent，检查 runtime 的远端注册与请求日志 |
| `[SKILL-ACTION] stage=delegate_returned` | 已收到匹配工具调用的回执，可能是业务结果，也可能是错误回执 |
| `stage=result_script action=reject` | 结果脚本读取/沙箱执行/输出解析失败，结合 SKILL-SANDBOX 日志 |
| `stage=result_processor action=reject` | 脚本已返回，但 success 不是 true；processorCode 可提供业务校验原因 |
| `stage=result_schema action=reject` | 直接返回或脚本归一化的后台结果不满足 result 契约 |

`[SKILL-SANDBOX]` 仅输出网关数值状态码、退出码、stdout/stderr 长度、失败阶段与异常类型。
不打印脚本、输入、metadata、回执、stdout/stderr 正文或异常原文；processorCode 仅接受有长度限制的大写错误标识。
业务脚本的 error 字段应为不含敏感信息的固定错误码，不能放用户数据。

例如本地 EDP 推荐处理器需要提取 `productList`，并验证产品字段以及非空产品列表的 `bankCardNumber`。
`MISSING_OR_AMBIGUOUS_RESULT` 表示未找到唯一符合形状的业务结果；`REMOTE_FAILED` 表示识别到失败回执；
`INVALID_CARD` 等表示业务字段校验失败。应对照脱敏后的真实 L2 回执修正资产适配，不能把空响应强制视为成功。

外层 SSE 的 success、controller 的处理完成话术、task_completed 表示传输/调度结束，
不覆盖父子 todo 的 FAILED 或 Skill 协议的 success=false。排查时优先看业务状态与上述阶段日志。

#### EDP 购买状态回执适配

若 purchase 在 `stage=result_processor` 报 `PURCHASE_RECEIPT_MISMATCH`，而实际 L2 回执为
`{"productBuyResponse":{"failCause":"","buyStatus":"1"}}`，原因是旧业务脚本强制要求 productCode，
并进一步要求 transactionId，而该接口没有承诺回传这两个字段。不是 A2A 调用或沙箱执行失败。

本地 EDP 的 fund_planning.py 已按该接口契约调整：
- 保留最新选品、余额、购买参数等前置校验，具体操作授权仍由 SkillActionRail 的确认与挂起调用匹配保证。
- 接受明确成功状态且无失败原因的 productBuyResponse；支持 JSON 字符串以及 SSE summary 包装。
- 归一化 product_id/amount 来源于当前确认请求，以 receipt_binding=CONFIRMED_REQUEST 标识，buy_status 来自真实回执。
- 回执若提供 productCode/productName/buyAmount/amount 则逐一核对；冲突、明确失败、回执缺失或不唯一仍拒绝。
- 转账和购买均不依赖或输出交易流水号，下游即使携带也不参与校验或归一化，绝不使用执行 ID 或随机值伪造。

此变更属于业务资产，不修改通用 Java 引擎。需同时部署
`assets/edp/skills/fund_planning_skill/scripts/fund_planning.py` 与
`assets/edp/skills/contracts/transfer.yml`、`assets/edp/skills/contracts/purchase.yml` 的 result 契约（移除流水号属性，购买保留 buy_status/receipt_binding），
并同步该 Skill 的 SKILL.md，然后重启加载新的资产快照。
这些资产仍被 Git 忽略，不在 JAR 中；只拉取代码或更换 JAR 不会同步此修复。
已成功购买但被旧处理器标记 FAILED 的会话不会自动修复；先通过下游交易记录核实，不要重复购买来验证修复。

脚本源码由宿主读取并通过 SysOperation 的 SANDBOX 模式执行，不接受模型提供命令或脚本路径。
脚本从环境变量 `SKILL_INPUT` 读取单个 JSON 对象：

```json
{
  "arguments": {"filter": "稳健"},
  "results": {},
  "versions": {},
  "metadata": {},
  "result": {},
  "execution_id": "...",
  "revision": 0
}
```

`result-script` 不是所有 operation 的必填项：A2A 的下游若直接返回符合 result 契约的 JSON object，
可以不配置结果脚本。运行时验证完整结果，再递归投影 summary 声明的字段；字符串、数组或非法 JSON 不视为成功结果。
这种模式须在 result 契约中约束业务成功条件（例如成功状态的 enum）；对象形状合法本身不能证明交易成功。
需要解包、重命名、复杂业务成功判定或展示话术时才使用结果脚本。SCRIPT 目前没有独立的原生 MCP 执行器，
其 result-script 同时承担执行入口，因此仍须有实际实现，不能将无实现的空操作标记为成功。纯 Markdown Skill 不必声明 operation。

`SCRIPT` 描述实现方式，而不是调度方式：公开 operation 由模型决定业务调用时机；internal operation 由执行引擎确定性衔接。
两者都不允许模型选择 Python 路径或生成执行命令。

- A2A 的 resultScript：`result` 是下游返回，必须自行归一化和判定业务成功。
- SCRIPT 的 resultScript：脚本自行调用 MCP/其他已授权服务；执行命令不是模型生成。
- beforeScript：返回 `{"allow": true}` 才能继续，用于成员归属、最新推荐、余额/金额等前置校验。
- resultScript：返回 `{"success": true, "data": {...}, "model_data": {...}, "message": "可选展示话术"}`。
- `data` 必须符合完整后台 result 契约：inline 配置中的 `output-schema`，或文件化契约中的 `contract-file.result`。完整结果保存在后台 SkillSession 并供脚本与结果绑定使用，不直接作为工具结果进入模型。
- `model_data` 可选。显式提供时优先使用，并校验公开 operation 的 `summary-schema` / `contract-file.summary`；省略时从 `data` 递归提取摘要契约声明的字段，包括嵌套对象和数组元素。未声明摘要契约时仍返回空摘要，绝不整体公开后台 `data`。
- 显式 `model_data: {}` 不触发回退，仍须满足摘要必填字段；显式 `null` 或其他非对象值报错。组合操作以公开入口的摘要契约处理最后一步结果，中间步骤不向模型返回摘要。完整结果与摘要的大小限制、成功判定不变。
- `message` 是可选的直接展示话术，不是模型摘要；需要友好业务回执时由结果脚本生成，资产维护者须脱敏。确认参数清单的配置见 [提示词与展示定制](prompt-and-result-customization.md)。
- 脚本只能输出一个 JSON 对象到 stdout；日志写 stderr。SDK/依赖须预装在沙箱，不自动 pip install。
- 第一版传输单文件源码；依赖模块应预装于沙箱，不能假定整个本地目录自动上传。

metadata 通过部署配置的 JSON Pointer 提取，仅传给脚本，不注入提示词。
当前 EDP 入口请求的字段位于 `custom_data.inputs`，运行时 metadata 的 `body` 保存完整请求体，绑定为：

```yaml
metadata-bindings:
  clientIP: /body/custom_data/inputs/clientIP
  userAgent: /body/custom_data/inputs/userAgent
  mainClusterSessionID: /body/custom_data/inputs/wap_sessionId
  wapbCookieList: /body/custom_data/inputs/wapbCookieList
```

左侧是传给脚本的 MCP 参数名，右侧是请求 metadata 的 JSON Pointer，不是原始请求体的相对路径。
缺少已声明字段会在 `prepare_input` 阶段拒绝执行，此时尚未连接 MCP；cookie 无内容时也需传空字符串。
每次交互请求都应携带所需字段。框架不写死 clientIP、cookie 等业务参数名。
固定 MCP 版本 `ICBCWAPBNEW_NLP_VER` 不参与 metadata 绑定，由 EDP 业务脚本直接传入 `beta`，不依赖环境变量，
不接受模型或前端覆盖；`wap_grayFlag` 不属于当前 MCP 参数契约，不转发。
通用 Rail 不承载业务默认值。除 `SKILL_INPUT`、`PYTHONIOENCODING` 外，现支持通过 operation 的
`script-environment.before-script/result-script` 声明环境变量授权，由 `ScriptEnvironmentProvider` 在每次执行前取值。
默认读取 Spring 配置，仅显式注入授权变量，不继承整个 Java 宿主环境；可通过业务 Bean 替换取值逻辑。
EDP refine 的结果脚本将 MCP_MASTER_URL、MCP_ACCESS_TOKEN、MCP_APP_NAME 分别映射为脚本现有的
EDP_MCP_SSE_URL、EDP_MCP_ACCESS_TOKEN、EDP_MCP_APP_NAME；沙箱不再需要预置这些业务变量。
本阶段不自动重载文件或进行主备重试；配置格式、SPI 和诊断说明见 [脚本环境变量注入](script-environment.md)。
绑定配置和脚本位于 Git 忽略的 `assets/edp`，需单独部署并重启刷新资产快照，不会随 JAR 自动更新。
身份凭据应来自受信任网关/运行时；JSON Pointer 不会自动把用户自报字段变成可信身份。
跨 A2A 的 metadata 可用性依赖 runtime 的请求传播配置，不能用模型补造。

每次成功操作递增 revision，后台 results 保存每种操作的最新校验结果，versions 给出对应版本。
revision 和 versions 由运行时生成，内部组合步骤各自占一个版本；脚本的 source_version、recommendation_version、
selection_version 记录上游结果依赖，用于过期检查，不是模型参数、外部业务版本或交易幂等键。
组合公开回执使用最后一步的版本，与根步骤在后台 versions 中的版本可以不同。
模型侧仅见 `operation/version/result_ref/summary`，`skill_results()` 只列公开结果索引，按 operation 查询也不会返回后台 data 或内部步骤。
结果回执和公开摘要由运行时按 operation 调用返回；运行时负责保存版本、校验依赖和组合内部步骤，不要求模型选择“最近成功结果”或复述后台传递字段。模型只有在需要理解已经保存的公开结果时才查询 `skill_results`，该查询不触发新的业务调用。
`output-schema` 是必需的后台 result 校验契约，不进入系统提示；`summary-schema` 校验公开摘要并只以精简公开投影进入模型提示。没有 operation 时不需要声明 operation 契约。
文件化配置可把三者集中放入 `contract-file`：`input` 用于完整 assembled input 校验，`result` 用于后台结果校验，`summary` 只投影模型需要理解的业务边界。只有公开输入和摘要的精简投影进入系统提示；运行时长度/数量限制、`query_payload`、完整卡号和 source/selection/recommendation version 等后台字段不会进入提示。未配置摘要时默认为拒绝额外字段的空对象，不回退暴露后台 data。
`input-bindings` 从已验证的后台结果通过 JSON Pointer 取值，`fixed-arguments` 由部署端注入；两者从模型输入契约移除，模型不能复述、覆盖或查询这些字段。`next-operation` 只允许衔接内部且无需确认、非终结的步骤；例如 `refine → refine_bind` 在同一次工具调用内运行，中途 A2A 等待可从快照续接。自动链最多 32 步、一个 A2A 等待，不是通用工作流引擎；交易确认仍由模型调用公开操作和用户授权。
变更操作契约或脚本后旧等待回调会失败关闭；切换结果隔离策略前创建的会话也拒绝恢复，需新建 conversation_id。先核实已发生交易，不要以重放交易的方式迁移旧会话。
首次推荐与重推荐可以是两个 operation；选品脚本根据 versions 选择最近来源并验证产品归属。
这不是强类型 Flow 数据依赖引擎：领域依赖校验归脚本，不从自然语言里自动生成业务约束。
参数变化、其他操作产生新结果后旧授权失效；重复同一个工具调用的结果使用收据，不能重复执行。
跨崩溃的外部副作用 exactly-once 仍依赖下游幂等键，不由本地收据保证。

## 5. 前端与中断

一个 L1 父 todo 下，实际业务工具启动时追加子 todo，不事先伪造已执行的 Skill 列表。
子项携带 `parent_id / scope_id / event_id / mode=append`；重推荐形成新的实际执行项。
`todolist_*` 只负责列出，`todo_start/end` 负责执行生命周期。
`think_chunk` 使用固定进度，不转发模型 reasoning。确认只由确认工具触发，原生 ask_user 的事件统一输出。

custom-rest 根据运行时 delegation 事件中的本地委派调用 ID，识别该请求流内的子远端任务，
只过滤这些任务的原始结果、推理与控制帧，不影响同一个 L2 的普通直接调用。
展示关联仅在单次请求流中保存；远端续接时运行时重新发布 delegation，不依赖跨请求展示缓存。
受控事件使用 `skill_protocol=native_skill_events_v1` 标记；标记不是签名或身份认证。
保留已识别的表单/认证交互，不保证未知 L2 私有 UI 协议自动兼容，应显式适配，不默认放行整个原始报文。
本地执行返回值供父 Agent 使用，不等同于直接展示给前端。
自然结束的原始文本保存在内部 `native_skill_v1` 终态的 output 中；独立 Skill 出口及 MOA
快路径出口返回该文本本身，A2A text part 不携带内部协议包装。业务 JSON 文本也保留原文，
不解析、不重新序列化。内部 checkpoint、父 todo 结果和执行成功判断仍使用完整终态；
慢路径继续由父 MOA 汇总业务回答。ask_user 继续使用原生中断状态和恢复 metadata。
L1 对授权 Skill 的回调提取 `native_skill_v1` 结果；失败、阻断、取消或缺少合法结果时父 todo
不会记为成功，原 AGENT/WORKFLOW 的结果处理保持不变。

### 取消确认与结束状态

`cancel_skill` 首次调用只弹出确认，不结束任务。用户确认后，Skill 返回
`status=cancelled/success=false`，其中 false 表示原业务未完成，不代表取消操作失败。
工具直接发送 `final_answer_chunk`：已取消当前任务，不再执行后续步骤。已完成的业务不会自动撤销。
L1 将当前父 todo 的 `todo_end.status` 和规划 phase 置为 `CANCELLED`；慢路径未开始的后序项置为
`SKIPPED` 并发送 `todo_skipped`，不再继续调用下游。已完成子任务和业务结果保留，不做回滚。
拒绝取消时仅提示未取消并保持 Skill 活动；取消结束后清除待执行状态和尚未使用的授权。
前端需识别 `CANCELLED`，不能仅凭 native_skill_v1 的 success=false 显示失败。
外层 `task_completed` 表示本轮 runtime 调度完成，不能取代 todo 的业务状态。

当前依赖 Core 在恢复中断工具后没有立即消费 requestForceFinish，而是在下一轮模型回调之后消费。
RailExecutor 会因已有终止信号跳过模型执行并返回空值，流式重试层却将它当成模型空响应，
因此取消时可能看到三次 empty 告警及非流式 fallback；这并不表示取消失败或实际重新调用了模型。
本仓库包含取消后的模型/业务调用计数、事件展示和 CANCELLED 状态回归；HTTP 用例本机执行受
loopback 连接异常阻塞，仍需在可启动 runtime 的环境验证实际前端。
彻底去掉该空重试需在 Core 恢复工具后及时消费终止信号，并让空流重试区分主动终止；
本次不修改外部 Core 依赖，也不通过吞掉日志或关闭正常模型重试掩盖它。
诊断日志增加 Skill `action=finish status=cancelled`、本地委派 `status=cancelled` 和父 todo `status=CANCELLED`。

## 6. 第一版明确边界

- 普通 ask_user、远端 L2 输入等待，均复用 runtime 原委派与 Core 检查点恢复，已覆盖多轮 HTTP 测试。
- 下游返回意图切换时，Skill 默认挂起并把信号交给父 MOA 重新路由，
  不把它当业务成功。ask_user 后也可通过 switch_intent 提出切换。
  旧 Skill checkpoint 尚无公开恢复协议，不自动重跑交易；详见 [意图切换](intent-switch.md)。
- 未实现任意节点强制抢占取消、历史执行自动迁移、动态工具加载、资产签名或跨实例分布式锁。
- 静态授权工具依然需要部署者配置业务输入输出契约；前后处理脚本按执行方式及适配需要配置，不把这些安全边界移到 Markdown。
- EDP AgentRule 可转为入口说明，但其专用话术参数、call_versatile 参数和脚本入参需要适配上述工具协议。
- 理财资产、真实模型、真实沙箱和生产 MCP/L2 尚未联合验收；测试使用脚本化模型和受控 stub。

## 7. 验证

```shell
mvn "-Dtest=NativeSkill*,Local*,ExecutionEngineTest,SkillActionRailTest,StagePlanningRailTest,IntentRoutingRailTest,MoaCustomRestAdapterTest,StageFlowIT" package
```

Windows 若临时目录过长导致 JDK HTTP 客户端初始化失败，可为测试 JVM 额外指定
`"-DargLine=-Djdk.net.unixdomain.tmpdir=<已存在的短路径目录>"`。

覆盖原生文档读取、ask_user 恢复、模型选择下一 Skill、跨操作结果、精确参数确认、重复回调、
新会话隔离、脚本契约、metadata 注入、意图切换阻断、YAML 配置绑定、前端输出过滤，
以及单个主 MOA HTTP 服务 → 进程内 Skill → 远端 L2 stub 的完整链路、L2 输入等待续接和业务失败回传。
HTTP 测试显式断言只有一个托管 AgentHandler，不注册 Skill 远端 AgentCard。
测试不使用旧 Flow Engine。

## 8. phoenix 本地联调工作区

从 `D:\AICapBdu\agent_java\moa-develop\moa_agent` 运行，业务资产位于其 `assets/edp`。
进入该工程后设置 `$env:SKILL_ASSET_ROOT = (Resolve-Path ./assets/edp/skills).Path`，
不要继续使用 `moa_agent_deepagent` 的绝对资产路径。资产和本地配置仍不提交、不打包；
详细的模型、沙箱、工作流 intent 和 MCP 参数准备要求见本地 `assets/edp/README.md`。

旧 `src/main/resources/skills` 中的本地 Flow/Skill Engine 资产保存在
`assets/edp/reference/skill-engine-assets`，不删除资产、不参与新宿主加载，也不混入 JAR。
旧版本会话和检查点不做自动迁移；切换方案后使用新的 conversation_id，并在独立工作目录中联调。
启动新实例前应先停止同端口的旧实例；仅启动一个启用本地 Skill 的主 MOA 实例，
不要另外启动 Skill 服务，也不要同时启动两个工作区的同名服务。测试不代表真实业务服务已连接。
## 9. 多资源定义与执行隔离

基座 `application.yml` 默认使用平铺单定义；多资源包能力仍然保留。
需要多个资源包时，改用 `definitions`，并清空顶层单定义资源（包括环境变量带入的值）：

```yaml
moa:
  skill-agent:
    enabled: true
    root: ""
    entry: ""
    operations: {}
    definitions:
      finance-skill:
        root: ./assets/finance/skills
        entry: entry
        workspace: skill-workspace
        max-iterations: 100
        operations: {} # 填入该定义自己的已授权操作，至少一个 terminal 操作
      account-skill:
        root: ./assets/account/skills
        entry: entry
        workspace: skill-workspace
        max-iterations: 100
        operations: {} # 独立声明，不继承其他定义的脚本或路由
```

候选 `kind: SKILL` 的 `adapter` 精确填写定义 ID（如 `finance-skill`）。定义 ID 必须为字母、数字、
下划线或连字符，不能等于主 Agent ID。未声明的 ID 拒绝执行，不回退任意默认 Skill。
非空的顶层 root/entry/operations 与 definitions 不可混用；切换时也要移除单定义业务配置，避免操作映射被合并。
以上空 operations 仅用于说明结构，不是可直接启动的完整业务配置。

每次执行按“定义 ID + 执行 ID”派生独立 Agent/Session，工作目录也按定义/执行分开。
续接状态保存定义 ID，从持久化定义恢复，用户输入不能改选资源；定义被删除时拒绝续接。
同一父计划仍保持一个活动子执行，不增加并行交易，也不实现 Skill Agent 池或运行时热加载。
沙箱继续引用 Runtime 的 SESSION 隔离配置；共享的是调用基础设施，不是业务状态和授权操作。
升级前仍处于中断的本地 Skill 没有定义标识，不承诺迁移其 checkpoint；建议先结束旧会话再升级。

服务带出使用独立的只读宿主，不放入交易候选目录，见 `service-lead-out.md`。
