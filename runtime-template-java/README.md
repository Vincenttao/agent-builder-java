# MOA 业务运行模板（开发中）

源自 agent-solution `552294d013b28a79d912a5bda9f627237e826e6b` 的 NativeSkillAgent 依赖闭包及两个 Runtime 扩展元数据访问器。保留来源版权、LICENSE 和第三方声明；逐文件原始/本地摘要见 `moa-source.json`。未导入 L1 规划器。

依赖固定为 Core 0.1.17、Runtime 0.1.4。适配包括 Session/工具/中断 API、MOA 原生调用生命周期 Rail，以及 DeepAgentSession 的 Core OTel 会话门面。外部仓库不修改。

当前是已编译及探测通过的执行基础，尚不是完整业务服务：`BusinessApplication` 入口、HTTP 业务接口和独立导出待实现。不要将此目录的构建成功视为 RD-01～06 完成。

验证：`mvn -f runtime-template-java/pom.xml test`。前提是固定版本 Core/Runtime 已安装。`LiveMoaProbe` 是显式运行的集成探测，不属于默认单元测试；其 fixture 模式不调用模型，操作使用声明的固定数据。真实模型和固定模型记录分别保留在 `test-results/dev-workbench-v2/p0/`。
