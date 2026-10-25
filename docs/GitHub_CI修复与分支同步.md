# GitHub CI修复与分支同步

日期：2026-10-25。按用户要求同步全部本地分支并处理GitHub失败；普通推送，不合并分支、不覆盖未知远端历史。

## 失败来源与修复

远端旧失败：[Platform checks / 40104007784](https://github.com/Vincenttao/agent-builder-java/actions/runs/40104007784)，对应demo分支尚未清理前的12206df；main也运行同一旧版工作流。当前dev分支已移除旧实现，不能用旧失败代表当前开发版本。

| 问题 | 实际证据 | 修复 |
| --- | --- | --- |
| 浏览器测试前就绪超时 | 日志停在Application readiness timed out，未执行浏览器用例；隔离复现编译后入口报Cannot find package @fastify/static | main/归档CI按deploy/Dockerfile既有pnpm deploy生产布局启动编译产物，并保存启动日志；不放宽健康检查或只增加超时 |
| 生成制品适配失败 | GENERATED_TOOL_BINDING_INVALID；夹具手写工具声明缺少现行固定契约的描述/连接/版本信息 | 测试使用equipmentRuntimeTool的规范声明；生产完整性校验和负向断言保持不变 |
| 共享部署测试最后写文件失败 | shared-session-evidence.json父目录不存在；隔离/取消断言此前已执行 | 测试显式创建所属输出目录，不删除证据或跳过断言 |
| 新分支缺少适用CI | 当前dev和清理后的静态Demo没有工作流；静态检查默认硬编码本机Chrome路径 | 两分支各提供与现有结构匹配的工作流；默认用Playwright管理的Chromium，保留显式路径覆盖 |

## 分支边界

- `dev/workbench-v2`：最新双角色可运行工作台，CI为npm冻结安装、类型、静态Demo和API/PC契约；不调用付费模型、不声称覆盖Java/真实业务验收。
- `demo/prd-v2-workbench`：PRD与可点击静态Demo，CI验证构建、身份及流程；不引回旧后端。
- `main`：保留其当前旧版应用结构，修复原Platform checks的生产布局和测试夹具。
- `archive/legacy-v1-20261025`：回移与main相同的三文件CI修复；原始归档提交619e391仍在历史。未提交的历史修改/未跟踪资料不计作需要发布的源代码。

初次同步前扫描590个尚未发布blob：本机实际凭据和.env.local未包含其中，无超过20MiB的新blob。归档目录56个原有修改/未跟踪文件在CI回移前后逐字节摘要一致；不暂存、不清理、不随推送发布。

## 验证边界与远端证据

本地通过：原就绪问题复现；生产布局服务实际启动与live=200；故意不给可用数据库时ready=503，未伪造数据库就绪；main类型检查、Java桥27项及两个原失败JVM适配用例；两个新分支的静态构建、5组身份和8组流程检查。YAML与完整diff检查通过。

本机Docker命令返回Input/output error，没有启动替代引擎或动现有容器；完整PostgreSQL/browser链路以远端真实CI为准，不把本机模块解析修复当作完整DB验收。

| 分支 | CI修复提交 | 对应远端运行 |
| --- | --- | --- |
| dev/workbench-v2 | f7cf33f | [Workbench checks](https://github.com/Vincenttao/agent-builder-java/actions/runs/40204964293)，已通过，全新安装及50项契约/桌面检查 |
| demo/prd-v2-workbench | 60f82a6 | [Demo checks](https://github.com/Vincenttao/agent-builder-java/actions/runs/40205058250) |
| main | f75111a | [Platform checks](https://github.com/Vincenttao/agent-builder-java/actions/runs/40205057705) |
| archive/legacy-v1-20261025 | bb30f69 | [Platform checks](https://github.com/Vincenttao/agent-builder-java/actions/runs/40205057529) |

表中是修复提交及初次推送的固定执行证据，不用新的执行ID替换旧失败记录；若后续修复产生新提交/运行，应追加说明。编写本记录时除dev外仍在执行，最终状态以对应运行与本次交付答复为准。本机摘要与保全清单在忽略目录test-results/ci-sync-20261025/。
