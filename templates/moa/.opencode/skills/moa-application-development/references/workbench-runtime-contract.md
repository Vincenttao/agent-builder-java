# 本工作台运行契约（本地适配）

本文件描述本工作台 Core 0.1.17/Runtime 0.1.4 的适配，**不是上游 MOA 原文**。上游固定来源仍由 SOURCE.md 和其他 references 声明。实现与测试优先于本文；涉及固定代码的修改由平台开发者处理。

## 先确定修改对象

应用从空 MOA 模板创建，先确认用户目标及服务地址，再编辑业务资产。不因用户打开某页而加入 i豆。业务定义引用同一工程的文件：

| 文件 | 责任 |
| --- | --- |
| application.json | scope、自身 Skill、挂载 Agent、连接、两层策略、字段映射 |
| instructions.md | 应用层 System Prompt，与业务范围和 Skill 保持一致 |
| skills/<id>/SKILL.md | 原生 Skill 指导，含 name/description frontmatter |
| skills/<id>/*.py | 受信任本机操作脚本；不是通用脚本沙箱 |
| adapters/operations.json | 操作标识到执行契约的对象映射 |
| tests/ | 应用层验证资产；写入文件不表示测试已运行 |

真实工程的 `runtime-tests/fixtures/idou/` 是手写集成测试样例。用户明确提出 i豆需求时可以读取其契约作为参考，但它不属于新应用的已装配业务，也不是助手自己的生成成果。不得修改该夹具或固定测试以让自己的业务通过。用户没有明确地址时先澄清，不自选企业端点。

## 操作定义与脚本

`application.json.skills` 的每项含 `id`、`file: skills/<id>/SKILL.md`、`operations: [操作标识]`。只有列入该 Skill 的操作才可用。操作定义在 `adapters/operations.json`；本 Demo 的本机 Python 使用 `type: SCRIPT`，`resultScript: <id>/balance.py` 相对于 `skills/`，不是工程根目录。保持脚本路径在所属资产内。

操作需明确 `inputSchema`、`outputSchema`、`summarySchema`、`confirmationRequired`、`terminal`、`maxCalls`。Schema 使用当前实现已验证的 object/properties/required/additionalProperties、array/items、string/enum、integer/minimum/maximum 等子集；不要假定任意 JSON Schema 关键字都受支持。非终结读操作不能被标成任务已结束。

脚本从 `SKILL_INPUT` 环境变量读取 JSON，输入中的 `configuration.connections` 与 `configuration.mapping` 由 Java 固定资产注入，模型不能替换。操作参数位于 `arguments`。脚本向 stdout 输出单个 JSON 对象：

```json
{"success":true,"data":{"available":1280,"unit":"i豆"},"model_data":{"available":1280,"unit":"i豆"}}
```

数值仅为格式示例，实际结果必须来自业务系统。`data` 和 `model_data` 应满足声明的结果/摘要契约。不得输出调试前缀、多段 JSON 或模型 Key。脚本使用 `/usr/bin/python3 -I`，不继承 PATH、HOME 或模型凭据；固定超时和输出上限由 Java 强制执行，不能依赖用户 Python 包或 shell。

i豆本机 Mock 的余额 JSON 字段为 `employee.wallet.availablePoints`；`mapping.balancePath` 应与实际接口对应。新模板的默认占位路径不是已验证业务映射。错误映射需修改保存并构建新运行；既有运行继续使用旧快照，不会自动修复。不得把错误结果填成默认余额或自然语言成功。

## 工具与任务终结

业务 Skill 指导模型调用已公开的工具：`call_mcp` 执行已授权操作，`confirm_action` 绑定需确认操作及参数，`ask_user` 补充必要信息。名称沿用 MOA 原生工具，不表示本工作台提供任意 MCP 服务接入。不要发明工具或自行绕开任务宿主。

只读业务按配置完成真实读取后走授权终结操作（样例为 `finish`）。`finish` 需要当前会话已有验证结果，或有真实拒绝确认回执；不得用它把失败或空执行包装成成功。参数确认后执行使用完全相同的操作和参数；用户拒绝时零写入。i豆 `redeem` 必须 `confirmationRequired: true`，固定 `employeeId: demo`；未知结果仅按原幂等键查单，不能新建键重发。

A2A 目标以 `capabilities` 中 `type: agent` 和 `connection` 绑定到已声明连接；范围外目标仍须挂载。后续原任务回答/确认续接原等待点，不重新全局路由。任务最多当前加保留共两个；恢复时复核事实并生成新确认。事件文件不是跨重启检查点；不生成跨重启自动续办承诺。

## 审阅和验证

联合核对 scope、System Prompt、业务 Skill 与操作目录。需要业务决定时提问，不擅自扩权。应用身份不得修改固定 Java、POM、开发 Skill 或 runtime-tests；发现范式契约问题应说明并交平台修订。

本机 OpenCode 默认禁止 Bash；不能因此声称已运行 Maven、Python 或业务测试。使用允许的编辑/读取工具完成差异，说明做了哪些静态核对、哪些检查未执行。真实编译、模型、Mock 账本和 Trace 由工作台后续验证。生成、审阅应用、构建成功、业务验收是不同状态。
