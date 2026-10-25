# DeepAgent 开发模板

DeepAgent 是与 MOA 并列的开发范式，不是某个固定业务应用。

使用同一工作台流程：选择模板 → 定义业务范围与System Prompt → 开发/装配业务Skill → 选择工具 → Coding辅助编排 → 检查、调试、交付。

本模板从空业务开始。首批执行器接通业务Skill与CORE文件工具（read_file/write_file/list_files），围绕当前目标维护会话工作区brief.md；Agent/A2A、HTTP/MCP或其他脚本尚未接通，不能仅配置名称就执行。

“短材料整理”属于examples/deepagent-materials应用示例，通过一个业务Skill和三个文件工具装配而成，不预置到范式模板里。
