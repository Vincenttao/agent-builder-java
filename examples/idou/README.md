# i豆福利参考应用资产

这是本仓手写的集成测试样例，用于验证 MOA 真实执行和独立 Mock。它不是新用户可选的 i豆模板，也不是 OpenCode 已生成应用的证据。新应用仍从空 MOA 模板创建；后续完整演示须记录真实编码与审阅过程。

`application.json` 定义业务范围、Skill、连接和接管策略，`instructions.md` 是应用指令；`skills/benefits/SKILL.md` 指导模型，`adapters/operations.json` 声明已授权操作和参数/结果契约。Python 资产只用于本 Demo 的受信任本机适配，不提供通用脚本沙箱。

部署时在 `application.json` 配置独立 Mock URL。模型 Key 由运行 Java 的环境提供，不写进这些资产。`redeem` 的员工固定为 demo，必须确认；这只是演示规则，不是企业用户鉴权。

构建后，指定 `WORKBENCH_APP_DIR` 为此资产目录，并指定 `WORKBENCH_STATE_DIR` 为运行状态目录，执行 `java -jar runtime-template-java/target/moa-business-application-2.0.0.jar`。默认 Java 监听 8780；需独立 Mock 和模型网络，Trace 需本机 Jaeger。`/workbench/turns` 是底层 Skill 执行接口，尚不代表应用级自动路由与两层恢复完成。
