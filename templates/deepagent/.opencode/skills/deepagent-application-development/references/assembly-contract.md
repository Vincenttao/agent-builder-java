# DeepAgent本机装配契约

这是本工作台适配契约，不是上游原文。原生DeepAgent执行模型循环；业务Skill提供指导，CORE工具完成受限文件操作。首期每会话只维护brief.md，不支持应用自行扩展文件名、网络、Shell或Agent接管。

## 最小关联示例

以下仅演示格式。用当前用户业务命名Skill、业务范围和说明，不把示例作为模板默认业务。保留application.json中未列出的合法字段：

```json
{
  "scope": {"own": ["根据用户提供的文本完成约定交付，并支持局部修改"], "delegated": [], "outside": []},
  "skills": [{"id": "text-delivery", "file": "skills/text-delivery/SKILL.md", "operations": ["read_file", "write_file", "list_files"]}],
  "capabilities": []
}
```

保持handoff.enabled=false，不装配Agent。operations中的每个标识都引用adapters/operations.json现有同名条目；其type必须为CORE，nativeTool与标识相同。新增JSON条目不会产生新的Java执行能力。id、file目录、Skill name保持一致。

业务Skill文件必须以规范YAML头开头：

```markdown
---
name: text-delivery
description: 根据用户提供的文本完成约定交付，或局部修改同会话原稿。
---

按当前应用业务要求处理原始事实；缺失信息标明未知，不编造。
首次生成前可用list_files确认有无原稿；增量修改先read_file读取brief.md，只改用户指定部分。
局部修改只替换用户指定事实对应的片段，并同步更新同一事实的关联引用；保留其他文字与结构。用户未要求时不增加变更日志、来源回顾或重新组织整篇内容。
用write_file保存brief.md，再read_file核对。错误或缺少授权不代表交付完成。
```

这里的description说明业务Skill在何种请求下适用。开发Skill的description说明何时开展工程开发，两者不要混写。

## System Prompt与逐轮授权

保留并按业务补充instructions.md的执行规则：每轮先通过skill_tool加载已装配业务Skill，再使用其operations允许的工具。上一轮授权不会自动续用。文件工具的file_path只能为brief.md；write_file还需content。遇到SKILL_LOAD_REQUIRED_THIS_TURN先加载本轮Skill，不重复盲试；遇到OPERATION_NOT_ASSEMBLED_FOR_SKILL检查装配，不换用未授权工具。

只有本轮文件非空、写后读回且目标完成时，才输出`<promise>ARTIFACTS_READY</promise>`。已有旧文件不代表本轮完成。增量请求复用同会话工作区，保留未涉及的事实和原有文本结构；只改被指定事实及其关联引用，不额外插入修改说明或来源变更记录。工具错误需要说明，不能输出虚假完成信号。

## 验证资产与开发交付

在tests中记录适用于业务的输入及预期；有增量修改需求时覆盖首次交付、局部修改和事实保留。预期由用户目标确定，不按模型实际输出倒改。README说明范围、限制与验证方式；写入样例文件不等于测试已执行。

交付前读回核对：Skill YAML name/description合法、引用存在、工具均已接通、System Prompt不矛盾、没有改固定资产或写入Key。OpenCode无Bash权限；应汇报静态核对完成、工作台结构检查/真实执行待验证，不自行宣称测试通过。
