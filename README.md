# 企业 Agent 开发工作台

这是按 [PRD 2.0](docs/Agent开发工作台_PRD_v2.0.md) 重新启动的项目。当前 `dev/workbench-v2` 分支已提供本机 Node.js 工作台、Git 工程、OpenCode 适配、Java 运行控制及技术导出。首个 RD-01～06 可运行 Demo 已完成分批真实验证；完整 PRD 及企业生产发布仍不在本次验收内。初始切片见[RD验收核对](docs/DEV-02_RD验收核对.md)；后续12项补齐及真实端到端证据见[最终验收与交付](docs/GAP补齐_最终验收与交付_20261026.md)。

产品主线：平台开发者交付 MOA 类范式和开发模板，应用开发者通过配置、装配和少量开发完成应用，再交给企业 CI/CD 发布。i豆是从 MOA 模板创建后提出的应用需求，不是另一个模板。

## 启动本机开发工作台

使用 Linux/WSL、Node.js 22.12+、Git，先安装依赖：

```bash
npm ci
npm run start:workbench
```

打开 **http://127.0.0.1:8768/**。页面和工程管理可先单独使用；右上角切换本机模拟身份。平台维护 MOA 模板并发行，应用方从发行版本创建空应用。工程数据默认保存在 `.workbench/data`，`WORKBENCH_PORT`、`WORKBENCH_DATA_DIR` 可分别指定端口和专属数据目录。一个数据目录只允许一个工作台实例。

实际生成使用 OpenCode 1.18.9，默认模型为 deepseek-flash；Java 调试需要 Java 17+、Linux Maven、Python 3，以及已安装的 Core 0.1.17/Runtime 0.1.4 依赖。Maven 优先使用 `.tools/apache-maven-3.9.11/bin/mvn`，可用 `MAVEN_BIN` 指定；Java 可用 `JAVA_BIN` 指定。模型凭据由外部环境或本机 `.env.local` 提供（权限 600），通用字段为 `MODEL_API_KEY`、`MODEL_BASE_URL`、`MODEL_NAME`，兼容原 `DEEPSEEK_*` 字段；不写入应用或提交。具体优先级、生效范围与旧包限制见 [模型配置与切换](docs/模型配置与切换.md)。

独立业务 Mock 在另一个终端运行 `npm run start:mock`，默认 **127.0.0.1:8770**，需在应用连接中填写实际地址；说明见 [Mock 接口](mock-business/README.md)。Trace 依赖独立 Jaeger：查询端口 **16686**，OTLP HTTP **14318**。平台原始 MOA 应用不包含 i豆业务；[手写参考资产](examples/idou/README.md) 仅用于集成测试，不是模板或 Coding 生成证据。

操作路线：检查并发行模板 → 创建空应用 → Coding助手生成/审阅业务修改 → 保存工程 → 结构/一致性检查 → 调试与业务回归 → 查看任务与Trace → 固定验证证据与双包导出。生成和业务运行会使用外部模型；OpenCode 开发上下文外发已获授权，并完成空应用多文件开发与审阅；用户已明确允许本 Demo 向 api.deepseek.com 外发必要业务上下文，首个 RD Demo 的实际业务与交付证据已补齐；其他目的地不因配置可填写而自动获得外发授权。不要把页面接通或导出成功视为全路线通过。退出时在所属终端 Ctrl+C，工作台会等待自有助手/Java 停止；Mock 和 Jaeger 独立管理。

同版刷新可恢复工程草稿、未发送开发需求、澄清回答和新业务需求；原任务业务补充回答仍仅保留内存。页面升级仅清理本 Demo 浏览器暂存，真实 Git、运行及导出记录保留。浏览器暂存不等于 Git 保存，也不恢复业务执行状态。

具体双角色、映射修复、两层任务、Trace/回放及独立包操作见 [可运行 Demo 演示与交付指南](docs/DEV-02_可运行Demo演示与交付指南.md)。

## 新增业务示例

已提供[预制 i豆商城、理财购买与综合业务主 Agent](examples/commerce-wealth/README.md)。主 Agent 用模型选择业务 Skill，Skill指导流程，独立 Mock 模拟账户与交易。使用 `MOCK_PORT=8772 npm run start:mock`，再运行 `node --import tsx scripts/install-business-examples.ts` 安装；新应用来自 MOA 空模板，预制资产明确为人工编写，旧工程不覆盖。solution 仓既有 Mock 与复用边界见[代码检查记录](docs/业务示例_Mock复用与主Agent分工.md)。

## 查看静态交互设计稿

只需要 Node.js，直接在仓库根目录运行：

```bash
node docs/developer-prototype-v2/scripts/serve.cjs
```

打开 **http://127.0.0.1:8768/**。也可以直接打开 [单文件 Demo](docs/developer-prototype-v2/开发工作台2.0.html)。启动不需要安装依赖，也不需要 Java、Docker、数据库、访问令牌或模型 Key。静态稿与真实工作台默认使用同一端口，请选择一个启动。

- 应用开发者：新建 MOA 应用 → 描述需求 → 审阅预设方案 → 能力与编排 → 调试与轨迹 → 交付预演。
- 平台开发者：右上角切换身份 → 维护范式与开发 Skill → 公共能力 → 模板检查与发行预演。
- 功能说明与完整路线见 [Demo 使用说明](docs/developer-prototype-v2/README.md)。所有模型建议、业务执行、轨迹及交付均为模拟，下载的 JSON 不是 JAR。

## 文档

| 入口 | 内容 |
| --- | --- |
| [PRD](docs/Agent开发工作台_PRD_v2.0.md) | 产品边界、角色、编排、需求和真实验收条款 |
| [交互设计](docs/Agent开发工作台_交互设计_v2.0.md) | 双角色导航、开发流程、页面及交互规则 |
| [MOA 业务规则分析](docs/MOA业务Agent分层与转交规则分析.md) | 固定源码快照、任务转交与 Skill 归属的依据 |
| [技术架构](docs/Agent开发工作台_技术架构设计_v2.0.md) | Demo 优先：Git、OpenCode、Java、Jaeger、DeepSeek 测试及独立交付 |
| [推进计划](docs/后续推进计划与执行要求.md) | Demo → 完整开发工作台；双角色统一设计，先讨论技术方案 |
| [来源材料与文档索引](docs/README.md) | 需求来源和 Demo 相关设计记录 |
| [历史项目归档](docs/历史项目归档说明.md) | 旧代码、文档和本地证据的保存位置 |

## 修改与检查

Demo 源码位于 `docs/developer-prototype-v2/src/`。修改页面、样式或脚本后生成单文件：

```bash
npm run build
```

内容版本变化后，浏览器自动清空本 Demo 的旧演示数据；同版本刷新保留进度。构建和静态服务只使用 Node.js 标准库。

静态设计稿浏览器检查：

```bash
npm ci
npm run test:demo
npm run test:flow
```

检查脚本使用本机 Chrome（默认 `/opt/google/chrome/chrome`），检查结果放入 `test-results/`，不提交生成产物。日常按变更选择相关检查，不要求每次运行全部历史脚本。

旧项目位于本地分支 `archive/legacy-v1-20261025`。当前分支不继承旧后端、数据库、Docker 配置、生成链或验收通过状态；实现依据本版 PRD 和新技术方案推进。

真实工作台检查使用 `npm run typecheck`，以及按变更选择 `verification/*.test.ts`；完整本地契约检查可运行 `node --import tsx --test --test-concurrency=4 verification/*.test.ts`。这些契约测试不调用真实模型。`verification/live-*.ts` 是显式外部集成脚本，不属于默认单测；历史成功不能代替当前修订验收。
