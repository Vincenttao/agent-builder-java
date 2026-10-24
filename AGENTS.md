# Repository collaboration rules

- This is a new product baseline. The active branch contains only PRD-related documents and the static Demo. Do not restore legacy backend, Java, database, Docker, generation, or acceptance code as an implicit dependency.
- Follow `docs/后续推进计划与执行要求.md`. DEV-02 and FULL-03 require technical discussion before implementation; do not automatically start them.
- Use `docs/Agent开发工作台_PRD_v2.0.md` as the product baseline. The Demo is simulated; real OpenCode, Runtime, OTel, and enterprise delivery remain separate acceptance targets.
- Legacy material is preserved on `archive/legacy-v1-20261025`; see `docs/历史项目归档说明.md`. Consult it only when relevant, and never treat its tests or old roadmap as the current project's task queue.

## Delivery and verification

- After each substantial, coherent feature, fix, or documentation change, run relevant checks, review the complete diff, and create one focused local Git commit.
- Push only when the user asks to publish or sync. Never stage secrets, `.env.local`, caches, generated test outputs, or unrelated user changes.
- Documentation-only changes need content, link, and diff checks. Demo changes need the affected build/browser checks. Do not run legacy Java/model/Docker regressions for this branch.
- Preserve independent acceptance assertions. Report implementation, build, simulation, and real business verification separately; record checks that fail or cannot run.
- Use the project's actual scripts. Demo build and serving require only Node.js; `@playwright/test` is a development dependency for browser checks.
- Keep new test output bounded and separate from historical evidence. Do not overwrite or delete prior records, shared resources, or unrelated data.

## Demo 更新与数据重置

- 源码为 `docs/developer-prototype-v2/src/`。每次修改页面、样式或脚本后运行 `node docs/developer-prototype-v2/scripts/build.cjs`。
- 内容版本变化后自动清除本 Demo 旧应用、草稿、运行、候选及平台演示记录；同版刷新和身份/应用切换保留进度。
- 仅清理本 Demo 拥有的浏览器存储；不得清理其他应用、真实业务或仓库历史证据。
- 修改构建或存储入口时检查版本重置、同版保留和旧标签页写回保护，并同步 Demo README 与 PRD。
- 仅面向 PC；页面需要检查的窗口为 1280、1440、1920px。按变更选择检查，不自动重跑全部历史脚本。
