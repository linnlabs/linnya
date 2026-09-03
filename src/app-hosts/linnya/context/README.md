# Linnya Context Bindings

Layer: `app-host`

`src/app-hosts/linnya/context/*` 承接 Linnya 专属的上下文绑定层。

这里负责：

- request/contracts 的产品形状
- chat request adapter
- app-specific 的 orchestrator factory
- Linnya 产品语义的 fence 注册与注入归并

这里不负责：

- shared context algorithm
- provider / preprocessor pipeline core
- working-memory / automatic compaction 的共享实现

真实 owner 边界：

- 通用 context core/profile：
  - 独立 Linnkit 仓的 `src/context-manager/*`
- Linnya 默认 context policy：
  - `src/app-hosts/linnya/context-policies/*`

## 当前轮文档上下文

Linnya host 会把当前轮的页面上下文、文档片段、引用内容等产品语义转换成 `fences[]`，再交给 linnkit 的 context manager 组装进最终 LLM messages。

约定：

- `document-context` 是当前轮 user-side 上下文，只应在最终当前 user message 的 `<user_request>` 前出现。
- `project-context` 统一承载项目名称、描述与 Renderer 已接纳的轻量文件清单；不得让 `document_list` 停留为无人消费的请求字段。
- 页面上下文、文档标题、文档片段需要归并成一个 `<document_context>`，避免同一轮出现多个重复的文档上下文块。
- `page_context.document` 是文档身份的权威来源；Slides 的 `slides_summary` 只保留当前页、总页数、警告数这类轻量状态，不重复输出 presentation id/title/version/layout。
- 点选 PPT 元素这类短期精确源码上下文走独立的 `selected-slides-element` fence，不写入历史消息，避免 source slice 过期后误导后续编辑。
- 通用 child-run 继承当前轮 `project-context` 与所有 `category=current-view` 的 Fence 快照；selection、引用、附件和父会话历史仍按各自显式策略处理。

推荐阅读：

- `src/app-hosts/linnya/context/agent-context-unification-plan.md`
- 独立 Linnkit 仓的 `src/context-manager/README.md`
- `src/app-hosts/linnya/context-policies/README.md`
- `src/app-hosts/linnya/agent-registry/README.md`
