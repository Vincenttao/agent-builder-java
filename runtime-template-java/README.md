# MOA 业务运行模板（开发中）

源自 agent-solution `552294d013b28a79d912a5bda9f627237e826e6b` 的 NativeSkillAgent 依赖闭包及两个 Runtime 扩展元数据访问器。保留来源版权、LICENSE 和第三方声明；逐文件原始/本地摘要见 `moa-source.json`。未导入 L1 规划器。

依赖固定为 Core 0.1.17、Runtime 0.1.4。适配包括 Session/工具/中断 API、MOA 原生调用生命周期 Rail，以及 DeepAgentSession 的 Core OTel 会话门面。外部仓库不修改。

已提供 `BusinessApplication` 可执行 JAR 入口、外置业务资产装载和 Skill HTTP 执行服务，使用 Runtime 的 Core 适配器和 MOA 原生工具循环。已接入应用意图路由、两层任务宿主与受控 A2A；工作台页面与技术导出已接入，导出包独立业务验收仍待验证；不要将构建或 Skill 联调成功视为 RD-01～06 完成。

验证：`mvn -f runtime-template-java/pom.xml test`。前提是固定版本 Core/Runtime 已安装。`LiveMoaProbe` 是显式运行的集成探测，不属于默认单元测试；其 fixture 模式不调用模型，操作使用声明的固定数据。真实模型和固定模型记录分别保留在 `test-results/dev-workbench-v2/p0/`。

`LocalSkillRunner` 是针对本 Demo 的受信任本机适配：只接受启动时登记的脚本文本，使用 `/usr/bin/python3 -I`，结构化 `SKILL_INPUT`，清空继承环境、限定超时和输出。它不提供远端 Sandbox 隔离，不支持任意 shell 命令或通用配置凭据绑定。企业脚本执行隔离仍属于后置能力。

`TaskShelf` 只管理同进程的业务任务规则及每任务独立 Core Session：当前任务与一个保留任务、切换决定、恢复复核、输入标识失效、已提交操作/回执归属。最多保留 128 个任务和最近 4096 个状态事件。已接入 `BusinessHost`，真实同进程等待/恢复与外部零调用分别留证；跨重启自动恢复不支持。

真实查询探测：先启动已配置的本机 Jaeger（HTTP 查询 16686、OTLP HTTP 14318），再运行 `node --import tsx verification/live-moa-http.ts`。脚本读取私有模型配置，自行启动并停止独立 Mock、编译 Java、执行真实 Flash/MOA/HTTP 查询，核对外部调用数和按 ID 取回 Trace。需 Linux Maven、已安装的固定 Core/Runtime 依赖和可用模型网络；失败记录保留，不自动重试模型。此探测仅覆盖查询，不覆盖确认、双层任务和发布。

服务验证：`mvn -f runtime-template-java/pom.xml package` 后运行 `node --import tsx verification/live-java-service.ts`。脚本把手写参考资产复制到独立目录，启动真实 JAR 和独立 Mock；覆盖查询、原确认回复、外来/重复回复拒绝、拒绝零新增写入和写后超时原键核对。当前脚本验证统一宿主入口，另含 A→B→A、B 失败、第三层零调用、复核与新确认、未知结果原键核对和只读查看。

`LlmRouter` 使用 Core Model 对下层业务范围做一次结构化仲裁，代码校验枚举、挂载目标和原任务引用；澄清/冲突不派发。`ControlledA2aClient` 复用 Runtime 所用官方 A2A SDK 1.0，仅支持受控非流式 Task 应答，校验远端 task/context 且不做自动业务重试。两者均已接入应用任务宿主，并完成真实 Flash + 独立 Mock 同进程联调。

消费方必须 import `agent-runtime-java:0.1.4` BOM，否则近路径传递依赖可能将 Protobuf 降到 3.x，导致 A2A 1.0 在发送前无法初始化。当前有效版本为 Protobuf 4.33.2（包含 util），来源和依赖树记录在本批测试日志；不能仅检查 POM 中 Core/Runtime 版本号。

统一宿主接口（JSON）：

- `POST /workbench/messages`：`{conversationId?: string, query: string}`，返回会话、当前/保留任务、待确认内容、处理事件及 Trace 引用。新会话不传 ID。
- `GET /workbench/conversations/:id`：只读查看；前端按事件回放，不触发模型、API 或日志追加。
- `POST /workbench/conversations/:id/reply`：`{taskId, token, answer}`，原任务补充/确认，直接续接原 Core 或远端等待点。
- `POST /workbench/conversations/:id/decide`：`{requestId, choice: RETAIN|STAY|DISCARD}`，处置原任务后才允许调用新目标；已提交操作不可假称放弃撤回。
- `POST /workbench/conversations/:id/resume`：`{taskId}`，恢复或重新复核；余额/礼品/参数检查失败停在待复核，通过后发新确认。确认标识有效期十分钟，旧标识不能用。
- `POST /workbench/conversations/:id/receipt`：`{taskId}`，只查询该任务原幂等键，迟到回执不抢占当前任务。

Runtime SPI 的外部会话映射和 input-required/原确认续接有确定性集成测试；不能据此推断任意外部 A2A 客户端的全部入站兼容性。已知定义冲突阻断当前修订的新派发/旧确认，需经 Coding 修订并运行新修订；原已提交操作的只读核对仍可用。

任务事件按会话追加到运行目录 `events.jsonl`，单会话最多 128 任务、4096 条内存事件、8 MB 事件文件；一个实例最多 64 会话。事件记录不是可重驱的 Core 检查点。进程重启后不自动恢复未完成任务，不能把事件文件存在当成恢复能力。当前工作台已接入该 Java 服务的运行控制 API，PC 交互与导出控制层经契约测试；完整真实双角色业务验收仍需单列验证。
