# 独立 i豆 / A2A Mock

运行 `npm run start:mock`，默认监听 `127.0.0.1:8770`；可设置 `MOCK_PORT`。这是独立进程，不依赖工作台服务。数据仅在内存中，重启清空，不是企业业务系统。

- `GET /api/employees/demo/balance`：嵌套字段 `employee.wallet.availablePoints`，初始 1280。
- `GET /api/gifts`：咖啡券 100、图书券 300。
- `POST /api/redemptions`：`employeeId/giftId/quantity/idempotencyKey`。同一键同一参数返回原订单，变参返回 409；账本最多 1000 笔。
- `GET /api/redemptions/by-key/:key`：核对原请求结果，不能用新键重试未知交易。
- `POST /a2a/procurement`、`/a2a/fallback`：受控 JSON-RPC `message/send`，首轮等待输入，携原 taskId/contextId 回答后结束；不是完整 A2A 实现，也不提供异步回调。消息仍需由宿主关联本地任务。
- `GET /__mock/state`：外部账本和调用记录，用于验收副作用。
- `POST /__mock/controls`：`redemptionDelayMs`（0～5000）在写入后延迟响应，模拟结果未知；`nextA2aFailure` 让下一次续接失败。仅用于本机 Mock 演示。

测试覆盖真实 HTTP 超时、幂等/变参拒绝、原键查单，以及 A2A 输入等待/关联错误。它们不证明 Java 业务接入或双层任务已完成。

当前 Runtime 使用 A2A 1.0。Mock 已增加 `SendMessage`、`ROLE_USER`、无 kind 的文本 Part 和 `result.task`/`TASK_STATE_*` 响应；`message/send` 旧格式仅保留给已记录契约，不用于宣称新 SDK 兼容。A2A 1.0 格式测试通过；完整 Java 业务宿主到独立 Mock 的转交路线仍待集成验证。
