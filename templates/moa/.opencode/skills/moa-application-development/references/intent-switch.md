# MOA 意图切换

意图切换用于挂起当前任务，基于用户新目标在当前能力目录重新路由；没有匹配时返回
标准切换信号，交给调用方处理。同一个 MOA 可处于任意编排层级，能力不区分 L1／L2。

触发来源包括下游 versatile 返回的既有切换信号，以及本地 Skill 在 ask_user 应答后调用
`switch_intent`。典型部署有 `MOA -> versatile` 和 `入口 MOA -> 领域 MOA -> versatile`；
下文中的 L1／L2 只表示这个示例中的相对位置。

## 部署

入口 MOA 和受托 MOA 使用相同的默认规则：本地匹配优先，无匹配返回意图切换信号。无需开启上抛开关。
可按业务调整同一处理链的切换次数上限：

```yaml
moa:
  intent-switch:
    max-switches: 5
```

初始意图识别或收到下游切换后，均按当前 MOA 的候选目录匹配；正常识别和召回后没有候选，
默认返回跨域信号。不能把无候选与识别、召回服务失败混为一谈：失败仍返回不可用应答，
不据此跨域分发。原有控制器返回 in_scope 且带有效细化 intent 时，本地没有匹配可复用
原控制器路由；此兼容规则仅用于远端 Agent/Workflow，不为本地 Skill 动态创建域外候选。
候选、意图识别 SPI 和执行器必须按实际业务部署；演示词表不能替代真实业务意图识别。
请求上下文 `openjiuwen.service.agentcore.request-context.enabled=true` 必须保持开启，
模型触发的切换从这个运行时快照读取用户原话。

## 信号及处理

继续接受既有 `versatile_handoff_not_in_scope` 和
`versatile_handoff_in_scope_intent_change`，包括嵌套 result、拼接 JSON 和文本前缀。

1. 下游返回切换时，挂起原计划未完成的任务，保留已完成结果。
2. 使旧 TARGET/SELECT/COMPOSE 交接失效，避免按旧目标再下派；新请求保留用户原话。
3. 当前 MOA 优先匹配可用的显式 intent，再按 query 分析；信号的 in_scope／not_in_scope
   标签不代替本地能力匹配。本地有候选则走既有快路径、候选澄清或慢路径；
   执行确认按新请求重新进行。
4. 本地识别和目录召回均无匹配时，将信号作为 A2A 业务结果返回父 MOA。该结果不是新的
   用户中断，也不是成功办理回执。父 MOA 的 IntentRoutingRail 再识别并分发。

向上返回示例：

```json
{"type":"versatile_handoff_not_in_scope","user_query":"我要转账","moa_switch_hops":1}
```

信号由框架构造；不会信任报文中的 adapter/domain 来选择执行器。最新运行时用户原话优先，
缺失时使用信号明确携带的 query/user_query；不补造新业务输入。

## 无匹配应答 SPI

`UnmatchedIntentHandler` 只在正常识别、召回及范围过滤后没有本地候选时调用；不替代意图
识别，不改变匹配候选，不创建新委派。框架自动注册默认实现，业务无需提供 Bean。
初始请求与切换后的请求共用此入口。识别／召回失败和切换超限直接结束，不调用此 SPI。

`reply(Request)` 的输入包含用户原话、显式 intent、当前切换计数及 Session：

- 返回 `Optional.empty()`：框架返回标准意图切换信号，保留原话及计数。
- 返回非空 `Optional<String>`：将文本或序列化业务结果作为终态应答，结束当前处理。
- 抛出异常或返回 null／空白应答：结束并提示应答策略不可用，不再下派或改成切换信号。

框架不根据候选数量或 agent-id 猜测自己是不是顶级入口。默认协议可由上一级或入口消费；
只有业务入口需要特定兜底应答时才覆盖 SPI，不必为受托 MOA 增加任何配置。如下示例应只注册
在需要该应答的顶级入口中；业务配置需在 MOA 自动配置之前注册，与其他业务 SPI 一致。

```java
@Bean
UnmatchedIntentHandler unmatchedIntentHandler() {
    return request -> Optional.of("当前暂不支持该业务，请重新说明您希望办理的服务。");
}
```

也可根据 Request 的业务上下文定制少数场景，其他请求返回 `Optional.empty()` 保持上抛。
原来的 `propagate-unmatched` 已移除；迁移时删除该属性，仅保留按需设置的 `max-switches`。

## 中断应答

本地 Skill 的 ask_user 恢复后，agent-loop 结合问题和回答判断是否明确换业务，通过
`switch_intent` 工具提出切换。工具没有 query 参数，模型不能改写用户原话。普通参数、
含糊回答、请求解释及取消沿用原业务流程，不能被当作新业务授权。

confirm_action、cancel_skill、stage_finalize 的确认，以及候选选择，沿用确定性输入处理，
不做意图切换的模型分类。确认仅接受既有肯定白名单，其他输入按未批准处理；候选选择
只接受编号或可唯一匹配的名称，不匹配时继续要求选择，不把自由文本重新路由。
框架系统提示词只定义 switch_intent 工具用途和约束，具体业务中哪些 ask_user 应答属于
新目标，可由业务 SKILL.md 定义；无需额外的中断意图分类器或独立分类提示词。
versatile 自己的业务交互仍由 versatile 判别并返回既有切换信号。

这属于模型语义判断，确定性测试验证工具及状态机协议，不代表真实模型的识别准确率；
生产上线前应使用参数回答、确认、取消、歧义表达、同域新目标和跨域新目标的对话集评估。

## 循环上限

`max-switches` 默认 5，取值 1..100，独立于 DeepAgent 的 maxIterations。
同一处理链内每次实际切换都计数；不能通过新 planRevision、相同 query、更换候选或反复
进入受托 MOA 清零。下派时计数经 A2A context metadata `moa.intent_switch_hops` 传递，
上抛时经信号 `moa_switch_hops` 返回；父 MOA 合并计数，不接受下游降低已记录的次数。
新用户业务请求重置本地计数，A2A 再委派请求继承父链计数。

达到允许次数后，不再进行下一次分发，返回 `success=false`、
`error=INTENT_SWITCH_LIMIT_EXCEEDED`。父 MOA 将失败收敛为本次处理结束，不把此错误重新
解释为意图切换。旧回调仍按 pending call 及 plan revision 校验，重复回调不发起新委派。

## Skill 接续边界

本次支持的是挂起和重新路由。Skill 切换后保存 `native_skill_v1` 的 `status=suspended`、
`success=false` 及嵌套 result 信号，清除当前 pending 和确认，不执行 result_script，
不生成办理成功事实、不撤销或重做先前已成功的步骤。本地委派收到此终态后交给父 MOA。
Skill 默认传递远端切换信号，不通过部署开关将其改成 blocked。

挂起任务清单是只读记录，当前没有恢复旧 Skill checkpoint 的公开执行协议。
用户再次提出原业务时是新执行，须重新采集参数和确认；不能自动重放交易。
后续若要支持真正接续，需要业务声明可恢复点、步骤结果有效期、过期确认处理和交易幂等，
并绑定旧 executionId/步骤版本及受信任用户身份。查询类 Skill 可按业务规则重新查询，
交易类 Skill 应由真实业务工作流检查已提交步骤及事务状态，不能仅靠模型对话历史恢复。

## 验证

回归覆盖默认本地候选匹配、无候选上抛、顶级入口 SPI 应答、SPI 异常收敛、分析失败隔离、
旧交接失效、同请求循环上限、父链计数、Skill
信号挂起、原生 ask_user 恢复后的 switch_intent，以及原有直接控制器委派兼容处理。
HTTP/A2A 集成用例使用本地 stub 和脚本模型，无需真实金豆 versatile 或交易系统。
