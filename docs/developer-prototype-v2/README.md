# 开发工作台 2.0 · 双角色交互 Demo

第一阶段 DEMO-01 的可点击设计稿。新应用开发者只看到 **MOA 开发模板**。创建应用后，向 Coding Agent 描述需求，审阅开发方案、配置系统接入、修改代码、调试和交付。i豆是本例的业务需求，没有 i豆模板或预先创建的业务应用。原 `docs/developer-prototype/` 保留。

## 打开方式

直接打开 [开发工作台2.0.html](开发工作台2.0.html)，或在仓库根目录运行：

```bash
node docs/developer-prototype-v2/scripts/serve.cjs
```

访问 **http://127.0.0.1:8768/**，端口可用 `DEMO_PORT` 修改。无需访问令牌、Docker、Java、数据库或模型 Key。静态服务只提供本目录允许的页面与资源，不读取 `.env.local`。

旧浏览器草稿继续保留。要体验全新应用开发者，请使用独立浏览器上下文，或点击“演示路线 → 重置本 Demo”；重置前会提示，它只影响本设计稿的数据。

## 应用开发者路线

1. **选择 MOA 并创建应用。** 填写名称“员工福利助手”，目标“为员工提供 i豆余额查询、礼品目录、确认兑换和结果核对，接入企业福利系统”。创建表单没有业务示例选择器。
2. **向 Coding Agent 提出需求。** 输入框带入刚填写的目标，可补充后发送；也可点击“根据目标制定开发方案”。查看方案与文件差异，再应用。名称与目标保留，继续在同一工程开发。当前明确标注预设内容，不是模型生成。
3. **接入系统。** “能力与系统接入”显示余额、目录、兑换、结果核对的接口契约和运行规则。选择“本地 Mock”并保存连接；企业测试环境尚未接通，选择它会阻止运行。
4. **查看和修改代码。** 编辑应用配置、业务 Skill、映射脚本；连接文件为只读视图，由接入页维护。未保存内容受保护；手工保存后，旧 Agent 建议不能覆盖新修订。
5. **调试应用。** 进入“调试与评测”，在标明身份的“终端用户模拟器”发送查询。切换“嵌套余额返回”使旧映射失败，查看 Trace 并交给 Agent 修复，再运行通过。
6. **验证用户体验。** 礼品选择、兑换确认只在模拟器中进行。待确认时更换礼品，旧确认失效；应用修订不变。可体验拒绝零写入、写后超时、按原交易核对且不新增订单。
7. **评测与交付。** 在“版本与交付”运行示例检查，固定候选、预览包结构、下载设计 JSON、预演企业 CI/CD。代码或连接变化使旧检查失效；修改测试礼品不会改变候选。

平台角色可单独演示范式工程、公共能力、开发 Skill 和模板发行。初始 MOA 模板已可使用，不要求应用开发者先扮演平台维护者。平台发行新版本不会覆盖已有应用；下次创建才固定新版本。

其他需求可以生成通用需求草稿，接口实现和执行器仍待补充，不会被套入 i豆业务。Demo 只保留一个活动应用，创建另一个前明确提示替换。旧运行快照不随草稿改动而重写；运行列表最多保留 20 条。文件直开与 HTTP 入口使用各自的浏览器存储。

## 演示与真实能力的边界

| 可点击能力 | 尚未接入的真实能力 |
| --- | --- |
| 双角色界面、MOA 模板、需求方案、差异与代码编辑 | 登录授权、真实 OpenCode 与开发 Skill 装载 |
| 系统连接选择、接口视图、查询/兑换/故障模拟 | Java/Runtime、Python 执行、企业接口 |
| 模拟 Trace、分步输入输出、只读回放 | OTLP 接收、观测查询与业务事件存储 |
| 示例检查、候选、企业交接和 JSON 清单 | 可执行 JAR、可构建源码包、真实 CI/部署 |

建议由预设规则给出；Java/Python 只保存文本，映射预演只识别两份预置脚本。下载包含 `kind: design-only`、`simulation: true`、`runnable: false`。示例检查不是独立业务验收，也不将 Mock 演示成功算成真实业务 E2E。

## 源文件与检查

可编辑源文件：[src/index.html](src/index.html)、[src/style.css](src/style.css)、[src/app.js](src/app.js)。单文件 HTML 随源文件一起交付。修改后按影响运行：

```bash
node --check docs/developer-prototype-v2/src/app.js
node docs/developer-prototype-v2/scripts/build.cjs
DEMO_CHECK_OUTPUT=test-results/prototype-v2-app-journey/final-journey node docs/developer-prototype-v2/scripts/verify-journey.cjs
DEMO_CHECK_OUTPUT=test-results/prototype-v2-app-journey/final-regression node docs/developer-prototype-v2/scripts/verify.cjs
```

浏览器检查使用仓库已有 `@playwright/test` 和 `/opt/google/chrome/chrome`，可通过 `DEMO_BROWSER_PATH` 更换。`verify-template.cjs` 保留为新旅程检查的兼容入口，不必重复运行。本批输出在忽略的 `test-results/prototype-v2-app-journey/`；首版及上次模板修正的证据目录保留。

本批 4 组应用旅程检查、7 组交互回归通过。先在旧设计复现“入口已有 i豆应用”；测试第一次跑新页面时因未从“我的应用”导航就查找新建按钮而失败，修正定位后通过，失败截图保留。既有确认、写入、回放和候选断言保留，补充测试输入不改变应用修订/候选的检查。详见 [应用开发者走查](应用开发者走查.md)。

[PRD 2.0](../Agent开发工作台_PRD_v2.0.md)、[交互设计](../Agent开发工作台_交互设计_v2.0.md)、[推进计划](../后续推进计划与执行要求.md)已同步。第二、三阶段先讨论技术方案，本批不开发真实前后端。
