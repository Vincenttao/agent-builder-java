# MOA 业务运行模板（开发中）

源自 agent-solution `552294d013b28a79d912a5bda9f627237e826e6b` 的 NativeSkillAgent 依赖闭包及两个 Runtime 扩展元数据访问器。保留来源版权、LICENSE 和第三方声明；逐文件原始/本地摘要见 `moa-source.json`。未导入 L1 规划器。

依赖固定为 Core 0.1.17、Runtime 0.1.4。适配包括 Session/工具/中断 API、MOA 原生调用生命周期 Rail，以及 DeepAgentSession 的 Core OTel 会话门面。外部仓库不修改。

当前是已编译及探测通过的执行基础，尚不是完整业务服务：`BusinessApplication` 入口、HTTP 业务接口和独立导出待实现。不要将此目录的构建成功视为 RD-01～06 完成。

验证：`mvn -f runtime-template-java/pom.xml test`。前提是固定版本 Core/Runtime 已安装。`LiveMoaProbe` 是显式运行的集成探测，不属于默认单元测试；其 fixture 模式不调用模型，操作使用声明的固定数据。真实模型和固定模型记录分别保留在 `test-results/dev-workbench-v2/p0/`。

`LocalSkillRunner` 是针对本 Demo 的受信任本机适配：只接受启动时登记的脚本文本，使用 `/usr/bin/python3 -I`，结构化 `SKILL_INPUT`，清空继承环境、限定超时和输出。它不提供远端 Sandbox 隔离，不支持任意 shell 命令或通用配置凭据绑定。企业脚本执行隔离仍属于后置能力。

`TaskShelf` 只管理同进程的业务任务规则及每任务独立 Core Session：当前任务与一个保留任务、切换决定、恢复复核、输入标识失效、已提交操作/回执归属。最多保留 128 个任务和最近 4096 个状态事件。它尚未接入执行宿主；状态测试不等于真实 Core 中断恢复、外部零调用或跨重启恢复已验证。

真实查询探测：先启动已配置的本机 Jaeger（HTTP 查询 16686、OTLP HTTP 14318），再运行 `node --import tsx verification/live-moa-http.ts`。脚本读取私有模型配置，自行启动并停止独立 Mock、编译 Java、执行真实 Flash/MOA/HTTP 查询，核对外部调用数和按 ID 取回 Trace。需 Linux Maven、已安装的固定 Core/Runtime 依赖和可用模型网络；失败记录保留，不自动重试模型。此探测仅覆盖查询，不覆盖确认、双层任务和发布。
