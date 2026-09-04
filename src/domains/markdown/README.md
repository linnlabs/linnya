# Markdown Domain

Markdown 是 Linnya 永久启用的平台默认文档领域，而不是可安装插件。它拥有 Markdown 文档内部结构与生命周期，但不拥有项目路径树、插件安装态或全局 Asset 账本。

同时，Markdown 也是一种可被其他领域复用的文本格式。Web 页面、Knowledge 内容、会话文件或插件输出可以使用 `text/markdown` 供界面预览，却不因此成为 Markdown 文档实体。通用语法导入/序列化能力可以复用；依赖 `document_versions`、rootBlock identity、pending revisions、Block 卫星表和批注的能力才属于本领域的文档实例。

## 稳定边界

- Workspace domain 拥有 `projects`、`workspace_nodes`、路径解析和 VFS 调度。
- Markdown domain 拥有正文版本、Block 卫星数据、修订、批注、normalization 和文档实例的文本/DocumentView 投影。
- Asset domain 拥有 `assets` 及资源归属关系；Markdown Block 只引用 asset identity。
- App Host 汇集各 domain 的 schema provider，共用同一个 `workspace.sqlite`。
- Markdown 通过 Host 的永久内建 provider 接入 Workspace 公共文档合同，与插件文档类型共享调用形态，但不注册为插件，也不进入插件生命周期。

## 当前迁移状态

Schema contribution、正文版本持久化、Block 卫星数据、pending revisions、normalization、DocumentView、富文档 Editor、默认文档结构和 file-style 全文写入已迁入本领域。正文版本现由单一 repository 管理；字符统计、工具修订意图归一化、pending 占位块变换和 accept/reject docJson 变换均为纯领域函数；批注由独立 feature 维护，但持久化事实属于 `rootBlock.attrs.annotations`，不使用 sidecar 表。所有新批注共享 schemas 中的实体创建合同，并由 annotations feature 的 `createMarkdownAnnotations()` 作为后端唯一创建用例：Review 专用工具只解析 ref，Workspace Markdown file write 只从普通 HTML comment 规划 draft；两者都直接写 `confirmed` 批注，只有正文差异进入 Revision pending。重复的 Workspace 块展平/preview 实现已经删除，canonical block projection 位于 domain shared，读取层不再根据异常 pending 猜测或补造块。VFS current text 与结构化 DocumentView 均通过 Markdown provider 读取领域自有版本、pending、图片和 Citation 投影，Workspace 不再查询这些表；document-write 通过 Citation 公开 source resolver 构建 Mark hydration，并通过注入的 Workspace mutation port 刷新节点时间，不读取 ToolContext 或直接写路径层表。Host 的统一 provider resolvers 已让 Markdown 和插件共享读取、Editor、生命周期、已有文件全文写入和缺失路径创建调用形态；Markdown 文件创建先编译、后在同步事务内提交节点与正文。ToolContext 已不再暴露 Markdown store/normalizer，通用工具只能经 Host provider 使用文档实例能力。

`text/markdown` 不是本领域的准入信号。通用预览只需要内容与 MIME；Markdown 文档 provider 则要求已经解析出的 Workspace 节点类型，或仅在缺失路径创建时使用明确的 `.md` / `.markdown` 声明。禁止用内容嗅探、MIME 或渲染能力反推数据库文档身份。

边界由 `scripts/guards/markdown-domain-boundary-guard.ts` 固化：Workspace 不得 deep import 本领域内部实现，五个通用 Workspace 工具不得直接依赖本领域，ToolContext 不得恢复具体 Markdown service。

Markdown 专属 Agent 工具位于 [`tools/`](./tools/README.md)。专属工具可以调用本领域公开 feature，但不会加入 Workspace 五件套；App Host 负责汇集其工具贡献。

旧路径不会保留 executable 或 import alias。每个阶段必须先切换全部生产调用方和测试，再删除对应实现。

## 持久化 Markdown schema 合同

`features/normalization/schemaLite.ts` 是 `content_json` 可持久化 node、mark 与属性集合的领域事实源。`workspaceMarkdownSchemaContract` 只公开名称和属性清单，供生产 Editor schema 做 conformance 门禁；它不会把后端 ProseMirror `Schema` 实例泄漏给 Renderer。当前 `link` 是正式 mark，属性合同为 `href/title`。

严格校验由 `validateMarkdownDocJson()` 统一提供：它先拒绝未知 node、mark 和属性，再调用 ProseMirror `Node.check()` 校验父子结构与 mark 组合。不能只依赖 `nodeFromJSON()`，因为它会静默丢弃未知属性。

Markdown 导入结果必须经过这份校验。pending 单块和文档级 Accept/Reject 在事务内合并完成后，也必须先校验最终完整 `docJson`，再保存版本并清理 pending；校验失败时正文和 pending 均保持不变。新增可持久化语义时，必须同时更新 schema、序列化/物化能力和生产 Editor conformance fixture，禁止让调用方自行猜测或静默降级。

## 数据模型

Markdown schema 当前包括：

- `document_versions`
- `audio_blocks` 及转录、笔记、摘要表（休眠 AudioBlock 的参考持久化链；当前不属于生产 Markdown schema）
- `code_blocks`
- `image_blocks`
- `latex_blocks`
- `table_blocks`
- `markdown_block_versions`
- `markdown_block_pending_revisions`

这些表通过 `workspace_nodes.id` 获得项目文档身份。外键依赖不代表 Markdown 可以调用 Workspace 内部实现；跨领域业务动作必须通过公共合同、port 或 app-level orchestration 完成。

AudioBlock 已从生产 Renderer/backend schema、创建入口和 Editor 运行时依赖中撤下，但实现源码与专属表暂时保留，供未来独立 Audio domain 设计时研究。保留代码不等于继续支持 `audioBlock` 文档：含该节点的旧 doc JSON 会按严格 schema 拒绝加载，不做兼容或降级。
