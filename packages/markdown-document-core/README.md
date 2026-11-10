# Markdown document core

本包拥有标准 doc/paragraph 与正式 Workspace rootBlock Markdown 正文的纯 schema、转换和只读 DOM 投影，供 Host Editor、插件 Renderer 与后台渲染 Worker 共用。无 Vue、Pinia、Node 内置模块或 Host 状态；模块导入和 Markdown 转换不访问全局 document。

`createMarkdownDocumentExtensions` 提供一份 Tiptap 内容定义，Renderer 可以传同名 NodeView 扩展替换表现；未知 JSON 节点、mark、attrs 由 `assertMarkdownDocument` 拒绝。`parseMarkdownDocument` / `serializeMarkdownDocument` 使用相同 schema 和 Markdown handlers。`createMarkdownDocumentFragment` 只使用调用方给出的 Document，生成的内容应放入 `.markdown-document-content`，并加载公开 `style.css`。

此包不拥有文档 ID/路径解析、引用权限、保存、修订、图片接管或模型调用。HTML 块默认显示源文，不执行嵌入内容；Host 如需 HTML 预览，应在自己的 NodeView 使用既有净化器。

`./validation` 是纯 JSON/schema 校验子路径，只有类型依赖；只需校验的存储消费者使用此入口，避免初始化正文扩展、Markdown parser 或公式 renderer。CSS 明确列为 package side effects，其余模块允许正常裁剪。

运行本包 typecheck 及 Node/DOM 业务测试；正文定义变更必须同时验证交互编辑和 Worker 投影，不能复制出另一套渲染 schema。

## 正式正文与可逆投影

节点沿用官方 `inlineMath` / `blockMath`，公式属性为 `latex`。行内样式包括 underline、highlight、textStyle（仅 color）、subscript、superscript；不开放字体或字号属性。JSON 准入同时检查未知属性、公式/颜色值类型与 ProseMirror 内容结构。

Markdown 使用 `++下划线++`、`==高亮==`、`~下标~`、`^上标^`、`$行内公式$` 与独立 `$$` 公式块。颜色使用官方 shortcode 形式 `[textStyle color="%23C00"]正文[/textStyle]` / `[highlight color="yellow"]正文[/highlight]`，属性值按 URI 编码转义；没有颜色的 highlight 仍输出 `==正文==`。这些 handlers 不经过 HTML/DOMParser，因此 Node 与 Renderer 解析一致。空或换行的行内公式用 `[inlineMath latex="…"]` 显式表示，公式里的 `\$` 保留为 TeX 转义，不误当结束符。普通 Markdown 强调、链接、代码、列表与表格规则继续复用官方扩展。

交互公式与只读 DOM 使用同一 KaTeX 信任、错误与 displayMode 配置，禁止 TeX 授予 HTML/链接权限。只读 fragment 会生成真实排版 DOM，调用方加载 `style.css` 即同时带上对应公式字体；不创建 Editor 或 NodeView。HTML 源文仍保持原有只读原文行为。

Tiptap 固定为 3.31.3；mathematics 的 peer 仅接受 KaTeX 0.16～0.18，因此这里精确使用 0.18.10。0.18.11 曾误以补丁版本发布 breaking strict 行为且已被上游弃用，0.19 不在当前 peer 范围内；升级必须与 Tiptap peer 及交互/只读公式回归一起进行。依据：[Tiptap mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics)、[Markdown 扩展合同](https://tiptap.dev/docs/editor/markdown/guides/integrate-markdown-in-your-extension)、[KaTeX 0.19 说明](https://github.com/KaTeX/KaTeX/releases/tag/v0.19.0)。

受管 image 可以携带可选的 `assetId`（字符串或 null），与 src 分开。DOM 使用 `data-asset-id` 保存身份，Host 可据此将展示地址替换为已接纳图片字节；本包不查资产库、不推断 URL 身份或执行接管。Markdown 的图片源地址仍由调用方准备，写回时的受管身份绑定由 Host 负责。

`./references` 是仅依赖 schemas 的纯 JSON 链接/稳定引用变换入口，供 Backend 与 Revision 复用已准入 Pending 身份；它不加载 Tiptap、DOM 或路径解析。`assertPortableMarkdownDocument` 使用本包唯一 canonical schema 做严格结构校验，Backend 不应另外构造近似 schema。

## 正式 Workspace 正文预览

`./workspace-schema` 拥有持久化 rootBlock 节点及 mark 合同。Backend normalization 仅转出这个入口；生产 Editor 的 conformance 测试验证注册表覆盖同一合同。标准 Markdown 与 Workspace 是不同正式模型，不通过 Agent Markdown 字符串互转来生成用户预览。

`./workspace-preview` 的 `createWorkspaceMarkdownPreview` 接收已投影 Pending 的 `WorkspaceMarkdownPreview`、调用方 Document、正文宽度、主题、AbortSignal，以及可选最大高度和 locale。返回可挂载的静态 element 和 dispose；不创建 Editor、不访问 Workspace、不请求资源、不注册文档会话。所有消费方必须加载 `./workspace-preview.css`，正文为 14px / 1.7 行高，按可用宽度换行，颜色继承统一预览外壳。

- 图片只消费 DTO 中已准入的 data URI：有 assetId 用 assetId，否则用 imageBlock.id；不自行打开持久化 src。出现可见图片资源缺失时明确失败，不伪装成完整预览。
- 按真实 DOM 布局逐 rootBlock 准备，等待当前块图片和字体后测量，到与最大高度相交的块即停。屏下图表和图片不会初始化；未传最大高度时生成全部内容。空 Pending 投影可显示空白，但保存 schema 仍为 rootBlock+。
- `./workspace-presentation` 由正式 Editor 与预览共用文本/图片 DOM、根块语义、列表编号与公式排版；颜色 token 在 `./workspace-colors.css`。预览 CSS 显式拥有根块宽度、缩进、图片和引用排版，不继承 Editor 为手柄/交互预留的全局样式；真实 Electron 对照覆盖 Host CSS 的加载顺序。Editor 的交互和 NodeView 生命周期仍留在 Editor。
- `./workspace-charts` 拥有唯一图表规则、主题、option、懒加载运行时和静态 SVG 出图；Editor 阅读面、PDF 和预览都消费它。预览按当前主题和宽度出图，重内容没有第二套简化实现。
- `./workspace-citations` 拥有引用去重、编号和参考文献派生/格式化。稳定文档引用只显示静态身份和标题，不递归挂载其他预览。
- 文档引用（超级标签）的外观只在 `./style.css` 定义一次，预览 CSS 不另行覆盖；颜色只取 currentColor，随纸色与主题变化，渲染 worker 无 Host token 也能正确绘制。标签图标位与编辑器、画布同一 DOM 合同，本包不带图标资源：调用方经可选 `referenceIcon` 提供图标节点，在量高前就位；缺省只显示标题。
- 链接保持用户可读外观，点击不直接导航；文档打开和预览交互由统一外壳负责。dispose 或 abort 立即移除测量 DOM 和已交付正文，不留下异步复活的旧内容。

验证入口：`pnpm --dir packages/markdown-document-core typecheck`；仓库根运行 `pnpm exec vitest run packages/markdown-document-core/src apps/renderer/domains/editor/features/chart-reading apps/renderer/domains/editor/features/citation apps/renderer/domains/editor/core/extensionRegistry.conformance.test.ts src/domains/markdown/features/normalization`。DOM 业务测试覆盖真实 ECharts SSR、公式、引用、受管/历史图片、屏下资源跳过与中途取消；实际字体、换行、主题和静态/详情一致性仍须在浏览器验收。

图表沿用 [ECharts SVG SSR](https://echarts.apache.org/handbook/en/how-to/cross-platform/server/) 的固定尺寸、关闭动画与 finally dispose 模式；无需在每张卡中保留交互实例。
