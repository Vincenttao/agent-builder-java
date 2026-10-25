# 独立 DeepAgent 本机运行

JDK17、Maven；Core0.1.17、Runtime0.1.4。`mvn package` 后运行 `java -jar target/deepagent-business-application-2.0.0.jar`。模型由 MODEL_API_KEY / MODEL_BASE_URL / MODEL_NAME 提供（兼容旧 DEEPSEEK_*）。WORKBENCH_APP_DIR 为工程目录，WORKBENCH_STATE_DIR 为独立运行状态目录。

执行使用 HarnessFactory 创建原生 DeepAgent、最多8次模型迭代、最多3轮目标循环和180秒完成超时。通过受限skill_tool读取已装配的业务Skill，再放行该Skill的CORE工具集合；未装配工具不可执行。文件工具只开放当前会话brief.md的读写、精确替换与列出；不提供 Shell/网络工具。每轮交付同时检查完成信号、文件存在、写后读回。未满足条件会明确显示未完成。
同会话增量请求复用既有工作区和 AgentSession。最多20个会话，每会话最多20轮；重启不恢复未完成执行。运行目录随既有工作台运行保留/清理策略管理，不另建无限测试工作区。

工作台的消息、只读事件回放和固定运行导出可用；不提供MOA的意图分发和A/B接管。当前新增模板未接入OTel，页面不生成虚构Trace链接。技术导出不包含运行材料，企业CI/CD发布另行验收。

装配配置沿用application.json的skills和operations，操作目录为adapters/operations.json；CORE描述符必须映射已接通的原生工具。开发Skill（.opencode）用于生成工程，业务Skill（skills）用于运行。两者独立；范式不绑定材料整理业务。

新增CORE操作replace_text：每轮先读原稿，按old_text字面量全部替换为new_text，其余字符不变，锚点不存在/原稿已变化/大小超限时拒绝，修改后仍须读回。装配此操作后write_file只创建新稿，已有原稿必须走受控替换；未装配的新旧应用保留原write_file兼容行为。平台应为需要局部修改的新应用装配replace_text并维护业务指导。
