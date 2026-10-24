# Repository collaboration rules

- After each substantial, coherent feature, fix, or documentation change, run the relevant checks, review the complete diff, and create a Git commit without waiting for a separate reminder.
- Use one focused commit per substantial change. Do not create commits for routine intermediate edits.
- Never stage secrets, `.env.local`, caches, temporary build outputs, or unrelated user changes.
- If required validation fails or cannot run, record that fact in the commit or report and do not describe the change as verified.
- Push commits only when the user asks to publish or sync them to the remote. A request to commit authorizes the local commit; a request to push or sync authorizes publication.

# Delivery and verification rules (2026-10-24)

- Follow `docs/后续推进计划与执行要求.md` for the active batch order and change-based checks. Historical TDD records are evidence, not instructions to resume full regression.
- Deliver the prebuilt-sample Demo first (RP-01); do not make runtime redesign or full PRD acceptance prerequisites for that Demo. Label sample provenance and retain existing publication checks.
- Use TDD at the layer affected by the change. Developer unit tests may be corrected with a recorded diff; independent acceptance criteria must not be weakened. Do not manufacture Java red tests for unchanged components or text-only assets.
- Run relevant checks once. Documentation-only changes need document checks; if they change machine-tracked acceptance metadata, run its existing consistency check only. UI changes do not trigger Java builds or model generation. Full phase acceptance is a separate delivery batch, not a gate for every local change.
- Rebuild only affected Docker services when their build inputs change and deployment verification is needed. Reuse one build for multiple tests; do not rebuild for evidence refresh, test-case changes, or unchanged image storage migration.
- Separate content identity from execution IDs. Preserve historical evidence and legacy candidate digests; cross-version evidence reuse requires implemented and verified compatibility rules.
- New test/build workspaces must have bounded retention and cleanup. Do not delete historical artifacts, project volumes, or unrelated data without verifying ownership, references, and authorization.
- Commit coherent changes locally after relevant checks. GitHub CI is not a blocker for local progress; do not push unless requested.

# 可复用执行约定（2026-10-24）

本节用于后续 Agent 接续工作；完整经验和环境交接见 [项目执行经验与控制要点](docs/项目执行经验与控制要点.md)。上述英文规则继续有效。

- 接续时先核验当前仓库、分支、工作区和实际目标状态，读取当前计划；旧会话、TDD 记录、通过数和历史端口只能作为线索。已结束的批次不自动继续，用户明确的最新范围优先。
- 每批明确一个用户可观察的结果、受影响层、最小验证和退出条件；用几行任务记录即可，不增加审批表或通用平台建设。完成本批后汇报并停止，不把后续架构改造或完整 PRD 验收变成默认前置条件。
- 稳定候选、确定性断言和既有回归由普通执行器复用；仅在生成或语义变化需要时调用模型。模拟生成、预构建复用、真实双角色生成必须明确标识，不能伪造会话或用一次成功掩盖失败尝试。
- 观察超时先检查原任务/进程的实际状态；仍在运行就继续观察，不因工具返回超时重新启动生成、构建、验收或发布。失败先区分实现、测试脚本、模型行为、环境依赖，再处理对应层。
- 需求、候选、制品、模型配置、测试集和外部证据应绑定实际版本；日志中的“成功”不能代替文件存在、接口调用次数和业务状态检查。模型评分不能覆盖硬性断言失败。
- 新批次不得覆盖旧报告、修改旧摘要或把无关证据计入当前通过结果。未提交证据要保护；迁移按文件清单与字节校验，保持未提交状态，不顺手提交、回滚或清理。
- 发生资源问题先盘点具体目录、镜像和进程，核验归属及引用；只清理授权范围。保留正在使用及回滚保留的产物；禁止默认执行全局卷清理、删除 VHDX 或终止所有 node/java 进程。
- 开发入口统一到 WSL Linux 文件系统；依赖使用 Linux 工具链安装，不复用 Windows node_modules/二进制。复用 Docker Desktop 同一引擎及数据卷，不默认另装引擎、起第二套主环境或启动所有历史部署。
- .env.local 与模型 Key 是本地配置，不写入提交、报告、截图或命令参数；在 WSL 中设为 600。验证配置时仅输出字段名、是否存在或一致性结果，不输出秘密值。
- 只为推送执行远端同步检查，不重复业务验收或修复无关 CI。先 fetch、核对分歧、审阅准确提交范围及密钥/大文件，再普通 push；不能强推覆盖未知远端修改。完成后核对本地和远端 SHA，并说明剩余工作区修改。
- 身份分离、共享 SDK、Skill 零 Java 编译是 RP-02/03 的待实现目标；未实现前如实报告实际路径，不能仅靠文档宣布具备增量构建或证据复用能力。

# Demo 更新与数据重置（2026-10-25）

- 每次修改 `docs/developer-prototype-v2` 的页面、样式或脚本后，运行其 `scripts/build.cjs`，使用源码内容生成的版本标记；新版加载时自动清除本 Demo 旧应用、草稿、运行、候选及平台演示记录，避免历史数据误导评审。
- 同一 Demo 版本内刷新和身份/应用切换保留当前进度；只清理本 Demo 拥有的浏览器存储，不清理其他应用、真实业务数据或仓库历史证据。
- 修改构建或存储入口时检查版本重置、同版保留和旧标签页写回保护；同步 Demo README 与 PRD，避免继续承诺跨 Demo 版本保留演示历史。
