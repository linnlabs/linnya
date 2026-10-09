# Research run presentation

本 feature 将 Host `research_run` 的正式结果与已接纳 `subrun_summary` 投影为研究过程卡。
工具完整与紧凑展示分别在 registry admission 使用共享 strict schema；Vue 不读取原始 payload，
不从 trace、阶段名字或文件路径推断研究是否正确。

运行中仅按真实 child 到达顺序展示已有过程，不预造六个阶段或猜测尚未接纳的 child。正式结果
用 artifact 的明确 stage 标识命名并链接已保存文档；未保存的真实 child 仍可查看 trace，但
不补造阶段、产物或终态。`inputs_changed` 显示材料变化和停止提示，已有文档仍保留，不能
显示为研究交付成功。保存成功只表示文件交付，不认证全文质量。

卡片复用标准 `ToolCallsMessage` 外壳、公开 `SubrunTracePanel` 与 `ConversationResourceLinkNode`。
trace 面板的 lifecycle 外观来自父工具，不能解释成各 child 的完成状态。此版本只展示轻量
工具过程，不提供 subagent 专用详情入口：阶段请求依赖前序文档，不能从父工具初始参数制造
六份假请求。完整文章与评审从正式 Workspace 链接打开。

测试覆盖 live 与 reload admission、已保存 artifact 顺序、材料变化后保留原件、未保存 child
仅有 trace，以及非法成功结果原子拒绝。本文不改变 Renderer 研究选项的入口映射。
