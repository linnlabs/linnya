# Research 执行适配器

research_run 是 Host
forced-tool 薄入口，不进入任何模型工具目录。它由平台 registry 装配正式工具上下文、同一数据库的文档/阶段回执、注册式 child
invoker；业务流程见 [Research 应用用例](../../application/research/README.md)。

每个 stage 使用持久身份和零轮历史继承；四种职责通过自包含请求和实际 Workspace 产物交接。固定材料研究的正式 Web/Knowledge 工具在 Host
decorator 拒绝执行，恢复同一阶段保留限制。该限制不承诺 Shell 网络或整个项目文件系统隔离。

工具失败抛出原有异常，取消向上传播；inputs_changed 是停止接纳旧版本的业务结果，不是全文质量失败。交付结果 schema 只包含真实产物路径、版本和 child 身份，正文仍在 Workspace 文档，不重复塞入结果。工具卡按真实 trace 展示阶段过程，阶段完成不显示质量通过。

`yield_after_batch` 的根运行 `completed` 只表示 Runtime 已结算本批工具；引用准入或保存失败会留下正式 `tool_output` error 并停止后继，只有研究工具的成功结果 `data.status=delivered` 表示文档交付完成。
