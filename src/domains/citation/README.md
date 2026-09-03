# Citation domain

Citation domain 管理跨 producer 的公共引用规则：Conversation 内的 6 位 ref 分配、同一 turn 内
`citations[].index` 的连续生产顺序，以及来源身份与正文引用的接纳。文档 Citation 的 Agent 阅读投影由
[`features/document-read/README.md`](./features/document-read/README.md) 维护。

## 边界

- Knowledge、Web 等 producer 只提交已规范化的稳定来源锚点；Citation domain 统一来源身份、6 位 ref
  候选规则和批量分配编排；
- Conversation 是 ref 唯一性边界。Host 使用原子 claim store 持久化
  `(conversationId, sourceIdentity) -> ref`，同来源复用，同 ref 不得被不同来源占用；
- `research.instanceId`、turn、单次工具调用和单个结果列表都不是 ref 唯一性边界；producer 不读取历史、
  不维护局部 `used Set`，也不直接访问 SQLite；
- 文档只保存已经接纳的 canonical `ref`，不得从界面编号 `[1]` 反向猜测；
- Knowledge 文档引用的稳定来源锚点是 `docId + blockId`，`kbId` 用于定位知识库；
- CitationNode 持久化的 title/snippet 是引用发生时的文档快照，不能依赖原 conversation 长期存在；
- Workspace 文件目录路径不是 Citation 身份；移动/重命名只改变 tree 属性，持久化的 docId/blockId 与
  引用快照保持不变；
- Editor `CitationNode` 的 ref 属于文档自身持久化快照。`read_file` 只在出站投影中把它映射成当前
  Conversation 的别名，不回写文档，因此移动文件或脱离原 Conversation 后仍能查看原始引用；
- Citation domain 不读取 Knowledge 文档、Web 页面或 Evidence bundle；
- `index` 是生产顺序，不是引用身份，也不是 Renderer 最终展示编号；
- Linnkit 只保存和回放通用 `RuntimeEvent`，不解释 `data.citations`；
- Linnya host 在 citation producer 执行前读取当前 working history，并把本 turn 已产生的
  citation 数量绑定到本次工具上下文。
- Conversation 中的 `ref` 是有作用域的短别名：当前 scope 精确命中优先，跨 scope 仅在所有候选指向
  同一稳定来源时解析；冲突或缺失必须 unresolved，禁止跨 Conversation fallback。
- 可见 Conversation message 必须携带正文实际使用的 citation dependency snapshot；该 snapshot 是
  可重建 read model，不是新的 Citation SoT。

## 代码位置

- `features/sequence/functions/computeTurnCitationOffset.ts`：从已接纳事件计算本 turn offset；
- `features/sequence/orchestration/citationSequenceContext.ts`：工具执行期的窄绑定；
- `features/reference/`：候选生成、原子批量分配编排与 allocator ToolContext 窄绑定；
- `shared/definitions/citationSourceAnchor.ts`：Knowledge/Web 的最小稳定来源锚点；
- `copyCitationSequence` / `copyCitationRefAllocator` / `copyCitationSourceResolver`：App Host 派生 ToolContext 时显式迁移 WeakMap 绑定，禁止通过对象展开丢失 admission；
- `app-hosts/linnya/adapters/tools/citationSequenceToolContextDecorator.ts`：host 与 Linnkit
  conversation view 的适配点。
- `app-hosts/linnya/adapters/tools/citationRefAllocatorToolContextDecorator.ts`：把当前 Conversation 与 Host
  claim store 适配成 producer 可消费的窄 allocator port；
- `app-hosts/linnya/adapters/persistence/citation-ref-claims/`：SQLite 原子 claim store，不拥有候选算法；
- `packages/schemas/src/citation.ts`：跨进程、持久化与工具协议复用的唯一 `CitationRefSchema`；
- `features/reference/functions/citationRef.ts`：canonical ref admission、工具入参归一化与展示投影；
- `features/document-read/`：持久化 CitationNode 的 Agent 阅读接纳、正文 token、窗口选择、缺失 ref 时的
  文档局部投影、source appendix 与诊断，详细合同见该目录 README；
- `features/conversation-presentation/`：Conversation 工具输出 admission、scope workspace、来源冲突、
  message dependency closure 与完整性校验；
- `conversation-presentation.ts`：Host / Renderer 共用的 runtime-neutral 窄公开入口，禁止从内部文件深引；
- `markdown-reference.ts`：Host / Renderer 共用的浏览器安全 Markdown 引用语法入口；
- `features/source-resolution/`：跨来源 DTO、完整命中、来源锚点冲突规则与 resolver ToolContext 绑定；
- `features/snapshot-history/`：严格读取已退出 live 生产链的 Knowledge CitationSnapshot，只服务历史卡片恢复与下载；
- `src/domains/markdown/features/document-write/`：Markdown 将本 domain 已接纳的来源投影成 CitationNode；Citation 不反向依赖 Markdown。

文档读取投影已经进入 live `read_file` 的普通 VFS text 与结构化 DocumentView。只有这两个正文入口
可以把 canonical `[@ref]` 连同同窗口来源事实交给 Agent；`grep` 与 pending diff 会遮罩 ref，不能成为
旁路 citation producer。禁止把 Evidence 文本拼进 Workspace reader，或让 Deep Research 建立私有
citation read 分支。

文档写入不得把解析失败的 canonical `[@ref]` 当普通文本落库。Knowledge 引用必须接纳
`docId + blockId`，Web 引用必须接纳 HTTP(S) canonical URL；同一 ref 指向不同锚点时必须
fail-fast。同锚点有多个快照时，Host resolver 按“当前 owner 输出优先、Evidence fallback 在后”的
顺序提供候选，Citation domain 统一接纳并保留第一条。

当前 `write_file/edit_file` 已通过 platform ToolContext decorator 取得 Host resolver；Markdown
document-write 只负责把接纳结果投影为 CitationNode。完整但非法的 citation-like token（包括合法/非法 ref
混写）会整体失败；fenced/inline code 中的示例保持普通代码语义。

插件通过 `@plugin/backend/citationSourceRuntime` 获取同一 Host resolver 的窄投影。插件只能看到已接纳的
Knowledge/Web 来源 DTO，不读取 Linnkit history、CitationSnapshot、Evidence bundle 或磁盘布局。

CitationSnapshot 不是 live Citation source，也没有 Agent 工具。Host 历史 API 必须通过
Citation domain 公开 reader 传入明确的 `conversationId / instanceId / bundleId`，不得让
domain 解析 ToolContext 或恢复 `citation_snapshot://` live 寻址。

文档读取只投影持久化快照，不进行隐式 Knowledge/Web 实时访问。Agent appendix 必须标明
`snapshot_status=persisted source_status=not_checked`；“未检查”不等于“可用”或“不可用”。若未来需要
实时来源状态，只能由来源 owner 通过窄 port 提供，不能让 Citation/Workspace 猜测。

工具必须通过 `requireCitationSequenceOffset` 和 `requireCitationRefAllocator` 读取 Host 绑定。直接实例化
Citation producer 时，调用方也必须显式绑定；缺少 admission 属于配置错误，禁止默认为 `0`、退回局部哈希
或扫描 Conversation history。

allocator 对一批来源执行一次短事务。每个新来源通常只做两次索引查询和一次插入；只有真实 6 位候选碰撞
才递增 salt，最多尝试 20 次。复杂度随本次来源数线性增长，不随 Conversation 历史长度增长。

`[@XXXXXX]` 的 Markdown 正文语法只由 document-read feature 解析；Evidence 只保存和解析已经
canonicalize 的裸 ref，不拥有 ref 正则、展示格式或 Markdown 抽取函数。插件若需要接纳工具入参，
只能通过 Citation public contract 使用 `normalizeCitationRef`，不能复制字符集。

Conversation Host 在 durable projection 写入与全量 rebuild 时，把 owner-admitted main/child citation facts
规范化到可重建索引。窗口只按可见正文 ref 查询候选，再通过本 domain 的 workspace 规则按 message 发生时点
裁剪 dependency sidecar。未来 tool fact 不得反向改变历史消息；同一来源重复接纳时保留首次快照。索引属于
Host read model，不能让 Citation domain 读取 SQLite，也不能成为第二套业务真相。
