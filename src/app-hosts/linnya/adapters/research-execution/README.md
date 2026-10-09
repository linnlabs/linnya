# Research 执行适配器

research_run 是 Host
forced-tool 薄入口，不进入任何模型工具目录。它由平台 registry 装配正式工具上下文、同一数据库的文档/阶段回执、注册式 child
invoker；业务流程见 [Research 应用用例](../../application/research/README.md)。

每个 stage 使用持久身份和零轮历史继承；四种职责通过自包含请求和实际 Workspace 产物交接。固定材料研究的正式 Web/Knowledge 工具在 Host
decorator 拒绝执行，恢复同一阶段保留限制。该限制不承诺 Shell 网络或整个项目文件系统隔离。

工具失败抛出原有异常，取消向上传播；inputs_changed 是停止接纳旧版本的业务结果，不是全文质量失败。交付结果 schema 只包含真实产物路径、版本和 child 身份，正文仍在 Workspace 文档，不重复塞入结果。工具卡按真实 trace 展示阶段过程，阶段完成不显示质量通过。

`yield_after_batch` 的根运行 `completed` 只表示 Runtime 已结算本批工具；引用准入或保存失败会留下正式 `tool_output` error 并停止后继，只有研究工具的成功结果 `data.status=delivered` 表示文档交付完成。

`submit_research_document` 是四种研究角色的唯一文档出口，参数只有 `content`。能力按准备好的
stage 注入，正文仅判空、不裁剪首尾空白，Markdown 解析仍归正式编译 owner。能力校验实际
child run 与 conversation；同伴、嵌套 worker 和父模型不能借用。路径、
project、来源 run 与 receipt 均来自 Host，不接纳模型提供的身份。成功 `data` 直接使用
`ResearchRunArtifactSchema`，`control.terminateRun` 结束 child，导航式 finalAnswer 只投影已保存文件。
父级读取 `resultToolName` 对应的成功 tool output 并与正式阶段绑定核对，拒绝自由终答。

提交复用 document owner 的同步事务，把文档、阶段绑定、child 的完整工具成功结果一起提交。
`ToolRegistry.returned` 不是这次写入的原子保障。原工具中断通过已有 atomic-owner receipt 恢复，
不把新工具加入通用可重试名单；另一 call 不覆盖已提交阶段。输入失效通过现有 child 取消信号
停止本次执行，父用例返回 inputs_changed，不把它反馈成可反复修正的 Markdown 格式问题。
