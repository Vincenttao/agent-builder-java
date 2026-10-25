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

业务Skill不能只写“调用balance/finish”这种省略描述；应明确操作通过原生工具桥执行。例如已装配余额操作时，先调用`call_mcp`，参数为`{"operation":"balance","arguments":{}}`，检查实际成功回执，再调用`call_mcp`，参数为`{"operation":"finish","arguments":{}}`。这里只是工具调用格式；实际operation和arguments以当前应用操作目录为准，不给每个业务都加余额操作。不要把operation标识当成独立工具名，也不要用TODO计划完成或自然语言答案替代业务调用。read_file加载Skill、路由选定Skill及TODO结束都不证明已调用业务服务。

只读业务按配置完成真实读取后走授权终结操作（样例为 `finish`）。`finish` 需要当前会话已有验证结果，或有真实拒绝确认回执；不得用它把失败或空执行包装成成功。参数确认后执行使用完全相同的操作和参数；用户拒绝时零写入。i豆 `redeem` 必须 `confirmationRequired: true`，固定 `employeeId: demo`；未知结果仅按原幂等键查单，不能新建键重发。

用户拒绝也是已核实的交互结果，有两种正常收束方式：在业务 Skill 允许时调用已授权 `finish`；或模型自然结束后由运行时确定性收束。后者的成立条件全部满足时才发生：Skill 会话仍为 `ACTIVE`、`pending` 与 `approvals` 为空、最后一条真实工具结果就是 `confirm_action` 的 `approved=false` 回执，且该回执的调用标识与最近结构化工具消息一致，消息后没有新的工具请求。此时任务正常 `COMPLETED`，结果为 `status=rejected`、`userDecision=rejected`，不表示兑换或查询成功，也不伪造任何读取或写入回执。判定只依据真实回执与真实工具消息，不依据模型正文或历史任意拒绝；拒绝之后若又出现新的工具尝试（包括未授权写入被拒），必须保持失败，不得当作拒绝成功。基础提示不再要求为结束额外发起一次模型调用或虚构读取。

A2A 目标以 `capabilities` 中 `type: agent` 和 `connection` 绑定到已声明连接；范围外目标仍须挂载。后续原任务回答/确认续接原等待点，不重新全局路由。任务最多当前加保留共两个；恢复时复核事实并生成新确认。事件文件不是跨重启检查点；不生成跨重启自动续办承诺。

## 路由阶段与后续强制实施

`LlmRouter` 只判断本轮输入的业务归属和候选目标，不推进任务，也不代表已经调用。返回 `SKILL`/`DELEGATE`/`HANDOFF` 只是选定已挂载目标；`CONTINUE` 只是把补参/确认归回当前任务。实际调用 Skill/Agent、参数确认与写入、任务切换等都由 `BusinessHost`/`TaskShelf` 在路由之后执行并强制校验，路由通过不等于业务已执行。

因此，当已有未完成任务（如等待确认）而用户又提出属于自身或已委派范围的新业务时，路由按新业务归属返回 `SKILL`/`DELEGATE` 即可；未完成任务的保留、询问或放弃由 `BusinessHost` 按 `handoff.unfinished` 策略在后续强制询问并在 `decide` 中落实，不要求用户在提出新业务的同一句话里先给出切换选择。缺少该选择不构成 `CLARIFY` 或 `CONFLICT`，也不得因此判定业务定义矛盾。

判定取舍：原任务的补参与确认仍为 `CONTINUE`；新业务本身信息不清可 `CLARIFY`；只有真实业务范围、System Prompt 或 Skill 指导之间的实质矛盾才 `CONFLICT`。仅存在当前等待点、或用户未在同句给出保留/放弃选择，都不是冲突理由。路由不授权绕过确认或直接调用新 Agent。给路由模型的路由上下文直接携带 `scope`/`handoff` 等原始结构（含 `own`/`delegated`/`outside` 数组），不得改写成 Map 或作其它投影，以免丢失真实业务范围。

## 路由预演样例的文件格式

若编写tests/routing-examples.json，根对象必须含cases数组；每条case的query为非空且互不重复的用户输入。工作台读取的是case顶层的action与target，不会从expected.operations或自然语言预期推断路由。正确的最小格式示例（Skill标识按当前应用替换）为：

```json
{"cases":[{"query":"查询我的余额","action":"SKILL","target":"balance-query","expected":{"operations":["balance","finish"]}}]}
```

示例只说明结构，不要求默认加入余额业务。SKILL的target必须是application.json.skills中实际id；DELEGATE引用挂载Agent id；HANDOFF必须启用接管并引用配置目标。CLARIFY、CONFLICT、CONTINUE按其真实语义使用，不伪造一个REJECT或OUTSIDE枚举来绕过检查。只提供操作顺序/业务答案的验收样例可以保存在tests/其他文件中；不要把这种不同结构放入路由预演文件。正向路由与业务结果断言分别表达，预演样例不表示真实模型执行已通过。

## 审阅和验证

联合核对 scope、System Prompt、业务 Skill 与操作目录。需要业务决定时提问，不擅自扩权。应用身份不得修改固定 Java、POM、开发 Skill 或 runtime-tests；发现范式契约问题应说明并交平台修订。

本机 OpenCode 默认禁止 Bash；不能因此声称已运行 Maven、Python 或业务测试。使用允许的编辑/读取工具完成差异，说明做了哪些静态核对、哪些检查未执行。真实编译、模型、Mock 账本和 Trace 由工作台后续验证。生成、审阅应用、构建成功、业务验收是不同状态。

## 预制商城/理财示例

主Agent可在自身scope下装配多个Skill，由模型路由到benefits/wealth；它们是本任务内的业务Skill，不冒充远程A2A Agent。`examples/commerce-wealth` 是人工预制资产，不是模板默认业务或助手生成证据。

受限本机写适配现支持redeem、transfer、purchase。transfer/purchase必须confirmationRequired=true、固定customerId=demo；转账固定本人funding→investment账户，转账和购买分别确认。transfer为terminal=false时，成功回执只完成一个操作步骤，继续原Skill；purchase为terminal=true结束本次任务。中间成功写回执保留在completedWrites，拒绝后续购买不能抹掉已发生的转账。未知转账不自动接着购买，按原key查单后结束本次任务，购买另行发起。不得把通用SCRIPT配置解释为任意新增写适配已受支持。
