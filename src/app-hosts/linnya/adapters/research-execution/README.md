# 已撤回的 Research 专用执行层

研究现在通过普通主 Agent、通用 subagent 和 Workspace 文件工具执行。现行职责、交接与恢复边界见
[Research owner](../../application/research/README.md)。

此目录原有的 research_run、submit_research_document、complete_research、材料绑定与接纳回调已退出后端执行注册并删除；不把同一逻辑搬进 child
invoker、文件工具或通用 ToolContext。研究父子提示负责指定稿件、材料和输出路径，Host 只提供现有通用运行能力。

历史工具 schemas、Renderer 展示和已保存文档保留，用于查看历史事实，不恢复旧执行入口。依赖撤回配置的暂停研究由通用恢复兼容性检查阻止续跑，不静默转换为新规则。
