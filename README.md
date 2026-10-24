# 企业 Agent 开发工作台

这是按 [PRD 2.0](docs/Agent开发工作台_PRD_v2.0.md) 重新启动的项目。当前分支只保留产品需求、相关设计与双角色可点击 Demo；真实前后端尚未开发。

产品主线：平台开发者交付 MOA 类范式和开发模板，应用开发者通过配置、装配和少量开发完成应用，再交给企业 CI/CD 发布。i豆是从 MOA 模板创建后提出的应用需求，不是另一个模板。

## 启动 Demo

只需要 Node.js，直接在仓库根目录运行：

```bash
node docs/developer-prototype-v2/scripts/serve.cjs
```

打开 **http://127.0.0.1:8768/**。也可以直接打开 [单文件 Demo](docs/developer-prototype-v2/开发工作台2.0.html)。启动不需要安装依赖，也不需要 Java、Docker、数据库、访问令牌或模型 Key。

- 应用开发者：新建 MOA 应用 → 描述需求 → 审阅预设方案 → 能力与编排 → 调试与轨迹 → 交付预演。
- 平台开发者：右上角切换身份 → 维护范式与开发 Skill → 公共能力 → 模板检查与发行预演。
- 功能说明与完整路线见 [Demo 使用说明](docs/developer-prototype-v2/README.md)。所有模型建议、业务执行、轨迹及交付均为模拟，下载的 JSON 不是 JAR。

## 文档

| 入口 | 内容 |
| --- | --- |
| [PRD](docs/Agent开发工作台_PRD_v2.0.md) | 产品边界、角色、编排、需求和真实验收条款 |
| [交互设计](docs/Agent开发工作台_交互设计_v2.0.md) | 双角色导航、开发流程、页面及交互规则 |
| [MOA 业务规则分析](docs/MOA业务Agent分层与转交规则分析.md) | 固定源码快照、任务转交与 Skill 归属的依据 |
| [技术架构](docs/Agent开发工作台_技术架构设计_v2.0.md) | 本机运行、OpenCode、Java 业务状态、观测、构建与企业交付 |
| [推进计划](docs/后续推进计划与执行要求.md) | Demo → 完整开发工作台；双角色统一设计，先讨论技术方案 |
| [来源材料与文档索引](docs/README.md) | 需求来源和 Demo 相关设计记录 |
| [历史项目归档](docs/历史项目归档说明.md) | 旧代码、文档和本地证据的保存位置 |

## 修改与检查

Demo 源码位于 `docs/developer-prototype-v2/src/`。修改页面、样式或脚本后生成单文件：

```bash
npm run build
```

内容版本变化后，浏览器自动清空本 Demo 的旧演示数据；同版本刷新保留进度。构建和静态服务只使用 Node.js 标准库。

需要运行浏览器检查时，再安装唯一的开发依赖：

```bash
npm ci
npm run test:demo
npm run test:flow
```

检查脚本使用本机 Chrome（默认 `/opt/google/chrome/chrome`），检查结果放入 `test-results/`，不提交生成产物。日常按变更选择相关检查，不要求每次运行全部历史脚本。

旧项目位于本地分支 `archive/legacy-v1-20261025`。当前分支不继承旧后端、数据库、Docker 配置、生成链或验收通过状态；后续实现从本版 PRD 和新技术方案开始。
