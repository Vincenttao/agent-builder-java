# 按角色扩展 Agent Rail

业务通过 `com.moaagent.agent.rail.MoaAgentRailProvider` 注册额外 Rail，主 Agent 和本地 skill-agent 共用一个 SPI：

```java
List<AgentRail> createRails(MoaAgentRailProvider.Role role);
```

| role | 创建时机 |
| --- | --- |
| MAIN | 主 DeepAgent 装配时；同一实例的多个请求复用这些 Rail |
| SKILL | 每次本地 skill-agent 创建时，包括中断恢复时重新创建 |

角色不表示 L1/L2 层级：L2 MOA 的主 Agent 也属于 MAIN。当前接口仅按角色区分，不传 Agent ID、Skill 定义 ID 或请求上下文。

## Spring 注册

Provider 是可多实现的 SPI。将实现注册为 Spring Bean 即可，无需替换 AgentHandler 或 LocalSkillDelegate，也无需 Java ServiceLoader 文件。
没有 Provider 时，保留全部原有 Rail；业务返回空列表表示不为该角色添加 Rail。

下面只为主 Agent 增加请求日志，其他角色返回空列表：

```java
package com.customer.agent;

import com.moaagent.agent.rail.MoaAgentRailProvider;
import com.moaagent.runtime.orchestration.MoaRuntimeAutoConfiguration;
import com.moaagent.runtime.skill.NativeSkillConfiguration;
import com.openjiuwen.core.singleagent.rail.AgentCallbackContext;
import com.openjiuwen.core.singleagent.rail.AgentRail;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.annotation.Order;

import java.util.List;

@AutoConfiguration(before = {MoaRuntimeAutoConfiguration.class, NativeSkillConfiguration.class})
public class BusinessRailConfiguration {
    @Bean
    @Order(100)
    MoaAgentRailProvider requestLogRails() {
        return role -> {
            if (role != MoaAgentRailProvider.Role.MAIN) {
                return List.of();
            }
            return List.of(new AgentRail() {
                @Override
                public void beforeInvoke(AgentCallbackContext context) {
                    LoggerFactory.getLogger("business.agent").info("role={} session={}",
                            role, context.getSession().getSessionId());
                }
            });
        };
    }
}
```

业务 starter 将配置类全名写入自己的 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`。
普通应用也可以使用已经被 Spring 扫描或导入的 `@Configuration`。多个 Provider 累加生效，不需要 `@Primary` 或 `@ConditionalOnMissingBean`。

## 装配顺序与生命周期

- 框架保留内置 Rail，再按 `orderedStream()` 收集的 Provider 顺序追加业务 Rail。不向 Provider 暴露可修改的内置列表。
- `@Order` / `Ordered` 控制 Provider 的收集顺序；回调执行顺序由 Rail 自身 `getPriority()` 决定，数值越大越先执行，不能靠追加位置保证执行先后。
- 原生 `AgentRail` 可用 `setPriority()`；继承 `DeepAgentRail` 时应重写 `priority()`，其 `getPriority()` 不读取 `setPriority()` 设置的值。
- Provider 每次调用应创建新的 Rail 实例，不应返回共享的 Spring 单例 Rail。Provider 本身及注入的业务服务可由 Spring 管理。
- 主 Agent Rail 会跨会话复用，需要保证线程安全。请求 query、metadata 和 Session 从回调上下文读取；跨中断恢复的状态存入 Session/checkpoint，不依赖 Rail 成员变量。
- 框架拒绝 null 列表、null Rail 及同一装配列表中的重复实例；允许同一 Rail 类的不同实例。跨 Agent 的实例隔离由 Provider 的创建契约保证。
- Provider 创建失败会阻止当前 Agent 创建，不会悄悄忽略扩展。MAIN 装配失败会影响应用启动，SKILL 创建失败进入既有本地委派失败处理。

Rail 可继承 `AgentRail` 或 `DeepAgentRail`，仍由底层 DeepAgent 管理注册与生命周期，MOA 不额外代理回调或改写优先级。
注册 Rail 不会自动扩大阶段工具或 Skill 工具白名单。模型上下文投影、操作完成和客户交互记录等已有业务 SPI 仍按原职责使用。
快路径可能不调用模型，因此模型回调不能用于覆盖全部请求的审计。

## 非 Spring 创建

直接创建 `NativeSkillAgent` 时，通过 `ExecutionServices.railProviders` 传入 Provider 列表；列表顺序就是注册顺序。
省略 Provider 的便利构造方法使用空列表。此列表保存的是工厂，每次 `NativeSkillAgent.create(...)` 都重新调用工厂创建 SKILL Rail。
