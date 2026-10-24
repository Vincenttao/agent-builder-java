# 请求路由与分析扩展

## 包布局

以下均为同一 Maven 模块中的 Java 功能包，不新增独立构建模块。

```text
routing/
  IntentRouter.java              路由入口、交接约束与决策校验
  IntentRoutingRail.java         Agent 生命周期接入、恢复与执行分派
  RoutingServices.java           请求级分析调用、缓存、超时与取消
  policy/                       RequestRoutingPolicy、DefaultRequestRoutingPolicy
  context/                      RoutingAnalysisInput、IntentHandoff、模型上下文投影 SPI 与实现
  selection/                    FastCandidateSelection、CandidateChoices
  recognition/                  意图识别、意图到能力候选的解析
  cardinality/                  任务数判断
  arbitration/                  候选意图仲裁
```

根包管理路由生命周期；policy 组合分析能力并产出决策；context 保存和投影请求上下文；
selection 管理客户选择。各个分析 SPI 与其默认实现放在对应功能包中。
`IntentHandoff` 与统一输入都承载路由上下文，归入 context，不单独建立只有交接类型的包。
`RoutingServices` 的构造器保持包级可见，由同包的 `IntentRouter` 创建，策略只使用公开的分析方法。

业务适配更新 import：`RequestRoutingPolicy` 与默认实现位于 `com.moaagent.agent.routing.policy`，
`RoutingAnalysisInput`、`IntentHandoff` 与 `ModelContextContributor` 位于 `com.moaagent.agent.routing.context`。
`IntentRecognition` 等已有分析 SPI 包名保持不变，工具名、会话状态键和请求报文保持不变。

## 调用边界

`RequestRoutingPolicy` 决定需要重新分析的新请求如何处理。框架在准备好当前服务带出上下文后调用策略，
业务返回 FAST、SLOW、SELECT、REPLY 或 BLOCKED，随后由执行层校验和分派。

以下情况有明确的运行时语义，不重新调用业务路由策略：

- 任务中断恢复、尚未结束的计划及挂起任务的选择恢复。
- 有效 TARGET 交接：执行交接明确指定的唯一目标。
- 有效 COMPOSE 交接：按交接范围进入规划。
- 唯一命中的显式 intent：形成直接执行决策。

SELECT 交接仍需分析，会进入策略；框架限制识别候选及最终决策不能超出交接范围。
无效或冲突的交接由框架直接阻止。策略返回 FAST 不代表跳过执行器支持检查或交易确认；
执行器不支持时仍可能回退到慢路径，最终路径以 `[MOA-ROUTE]` 日志为准。

## 五个 SPI 的职责

| SPI | 职责 | 默认行为 |
| --- | --- | --- |
| IntentRecognition | 识别业务意图候选 | 从部署目录匹配，不决定处理路径 |
| TaskCardinalityAnalysis | 判断单任务、多任务或不确定 | 模型判断，不以候选数量代替任务数 |
| IntentArbitration | 从给定候选筛选相关业务 | 模型筛选，不新增候选 |
| RequestRoutingPolicy | 组合业务规则与分析能力，决定如何处理 | 并行识别和任务数判断，必要时仲裁 |
| CapabilityDiscovery | 为慢路径准备规划能力快照 | 优先复用路由候选；为空才匹配目录 |

`DefaultRequestRoutingPolicy` 实现完整默认分流算法；`IntentRouter` 负责交接与显式目标优先级、
请求级分析服务的生命周期及最终决策校验。默认算法不会通过回调重新进入 Router。
默认 SINGLE 且一个候选时直接执行；SINGLE 且多个候选时仲裁。
仲裁唯一候选直接执行，二到三项可进入客户选择，更多候选进入规划；UNKNOWN/MULTIPLE 进入规划。
识别或任务数分析失败阻止执行；仲裁无匹配或不可用保留候选走慢路径，调用线程中断始终阻止执行。

## 统一分析输入

意图识别接口只保留：

```java
import com.moaagent.agent.routing.context.RoutingAnalysisInput;

List<CandidateCard> recognize(RoutingAnalysisInput input, Session session);
```

不再有 `IntentRecognition.Input`。四个分析/召回接口统一使用 `RoutingAnalysisInput`，
其中 query 是原始输入，serviceLeadOut 是不可变的本轮服务带出快照。
Session 显式提供给识别实现，用于业务历史和元数据读取；不要求使用线程本地会话。
`RoutingAnalysisInput.current(query, session)` 是显式读取会话快照的工厂，已有快照时直接构造即可。

调用模型或外部分类服务时使用 `input.modelData()`，或对 serviceLeadOut 做公开投影；
不要将带出 token、拒绝指令等内部字段直接拼入提示词。

## 业务策略与请求级缓存

接口为 `route(Request request, RoutingServices services)`。
`RoutingServices` 是框架为当前路由创建的具体服务门面，不是新增 SPI，不需要业务注册 Bean。

- `recognizedCandidates()`：按需识别并读取只读候选。
- `taskCardinality()`：按需读取任务数。
- `analyze()`：并行启动尚未执行的识别与任务数判断，返回 AnalysisSnapshot。
- `arbitrate(candidates)`：仲裁识别候选的有序子集，校验序号范围及重复项。
- `selectionCandidates()`：读取 SELECT 交接的允许范围；普通请求为空。

业务与默认策略共享同一个 services。识别、任务数及相同有序候选列表的仲裁只执行一次，
成功、异常和超时均复用；不同请求重新创建缓存，不将会话历史当作本轮分析缓存。
识别与任务数使用首次分析开始时计算的共同期限，仲裁使用独立期限。
默认策略保持并行分析，业务提前答复或领域直派可以只执行识别。
路由返回后框架取消未结束的分析任务，services 不得跨请求保存或用于异步后台工作。

业务规则未命中时，直接委托默认策略并传递同一 services：

```java
import com.moaagent.agent.routing.IntentRouter;
import com.moaagent.agent.routing.RoutingServices;
import com.moaagent.agent.routing.policy.DefaultRequestRoutingPolicy;
import com.moaagent.agent.routing.policy.RequestRoutingPolicy;

private final RequestRoutingPolicy fallback = new DefaultRequestRoutingPolicy();

@Override
public IntentRouter.Decision route(Request request, RoutingServices services) {
    List<CandidateCard> candidates = services.recognizedCandidates();
    if (canReply(request, candidates)) {
        return IntentRouter.Decision.reply(answer(request), Map.of(), "business_reply");
    }
    return fallback.route(request, services);
}
```

已移除 `RequestRoutingPolicy.Analysis` 和 `defaultDecision()` 回调。
模型规划仍必须为每项 todo 显式提供 candidate_ids；需要额外的 Skill、组合能力或工作流时，
业务接管 CapabilityDiscovery 扩充规划候选，不依赖默认实现再次加入已被路由筛掉的能力。
