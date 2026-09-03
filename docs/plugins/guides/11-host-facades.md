# 11 · 宿主平台门面（SDK）

> 适用场景：插件需要 host 还没暴露的能力；新增或扩展 `@plugin/backend/*` /
> `@plugin/renderer/*` 门面。

## 总原则

插件运行时只能通过 `@plugin/backend/*` / `@plugin/renderer/*`
窄门面消费宿主能力，**禁止 deep import
`src/electron-main/*`、`src/app-hosts/*`、`src/features/*`、`@/domains/*`**。需要新能力时，正确做法是**新增一个窄门面**，而不是 deep
import 或在 host 里塞插件专属逻辑。

## 接入五件套

实战中门面反复返工的根因是「要同步改的地方不止一处」。新增/扩展一个门面，必须同步五件套，缺一就会「源码态能跑、磁盘 artifact 态报错」：

| #   | 改动点                                                       | 作用                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `src/plugin-sdk/{backend,renderer}/<name>.ts`                | 门面实现：在契约类型约束下 re-export 或薄包装 host 能力，只暴露窄接口。纯字符串/纯类型门面可在 SDK 内自实现（如 `agentRegistry.buildPrompt` 用 `fillTemplate` 填模板，不再 re-export host 内部函数），禁止 re-export host 内部 domain 实现。 |
| 2   | 运行时解析登记                                               | backend 走 `src/electron-main/plugins/loader/backendHostModuleResolver.ts`；renderer 走 host module provider + `plugin://host/...` shim（`pluginProtocol.ts`）。                                                                             |
| 3   | `packages/plugin-host-contract/{backend,renderer}/<name>.ts` | 插件视角契约真源；只放窄接口和纯结构类型，不依赖 host 内部实现。                                                                                                                                                                             |
| 4   | 插件 `tsconfig.json` 的 `paths`                              | 按 `@plugin/backend/*` / `@plugin/renderer/*` 通配符映射到 `@linnya/plugin-host-contract`；renderer 还要在 `packages/plugins/rendererHostExternalMap.mjs` 把 external 改写成 `plugin://host/...`。                                           |
| 5   | 边界守卫规则 / 测试                                          | `scripts/guards/agent-package-boundary-guard.rules.ts` 登记允许方向 + 守卫测试防漂移。                                                                                                                                                       |

renderer 门面还要额外确认三处：

- `apps/renderer/app/plugins/loader/hostModuleProvider.ts` 能把源码态
  `@plugin/renderer/<name>` 指到宿主同一份单例。
- `src/electron-main/plugins/loader/pluginProtocol.ts` 的 `plugin://host/...`
  shim 能导出浏览器 ESM 可静态分析的 named exports。
- `packages/plugins/rendererHostExternalMap.mjs` 把插件 dist 里的 bare
  specifier 改写为
  `plugin://host/...`，否则磁盘 artifact 会在用户环境里解析失败。
- 插件包 `tsconfig.json` 不逐个登记门面；新增契约后由通配符纳入。`host-types/`
  只允许保留 renderer 环境声明、插件自有引擎声明等非 host 镜像内容，不要再新增
  `hostImports.d.ts` 这类手写桩。

## Renderer UI package 与 Host 门面的边界

跨 Host/插件稳定复用、且不需要 Host 状态、权限或业务 port 的 Vue 控件、平台图标、token、主题、本地化合同与 scroll capability 属于 `@linnya/renderer-ui`，不属于 `@plugin/renderer/*`。插件直接声明并导入 package 的公开入口，运行时由 Host 通过 `plugin://host/renderer-ui/*` 提供同一模块身份；CSS 只由 Host 装载一次。

旧 `@plugin/renderer/toolUi` runtime facade 已完成退出：基础控件与平台图标由 `@linnya/renderer-ui` 提供，工具卡
presentation 类型直接依赖 type-only `@linnya/plugin-host-contract/renderer/toolUi`，`isRecord`、字符串/数字读取等
payload decoder 回到各插件 feature。Host 不再提供对应 module、protocol shim 或 external。需要 Host store、Electron
adapter 或 app-level orchestration 的能力仍必须设计成按业务能力命名的窄 facade，不能重新建立通用 UI barrel。

## 现有 subrunToolUi 门面

`@plugin/renderer/subrunToolUi` 是一个刻意独立的重型 UI 门面：普通工具卡继续使用
`@linnya/plugin-host-contract/renderer/toolUi` 类型合同，只有需要复用宿主 subrun 对话分组时才加载 `SubrunCard`。它当前只公开
`SubrunCard` 及历史 trace 的纯类型契约；使用规范见
[20 Subrun 过程展示](./20-subrun-process-ui.md)。

扩展这个门面时，五件套对应位置是：

| 改动点                | 当前真源                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| SDK 门面              | `src/plugin-sdk/renderer/subrunToolUi.ts`                                                              |
| renderer 同单例模块表 | `apps/renderer/app/plugins/loader/hostModuleProvider.ts`                                               |
| 插件视角类型契约      | `packages/plugin-host-contract/renderer/subrunToolUi.ts`                                               |
| 磁盘 artifact 解析    | `packages/plugins/rendererHostExternalMap.mjs` 与 `src/electron-main/plugins/loader/pluginProtocol.ts` |
| 守卫与验收            | runtime loader 必需模块检查、官方插件 typecheck/artifact smoke，以及使用方的业务测试                   |

新增 runtime named export 时必须同步 protocol
shim 的静态导出清单；只新增 TypeScript 类型时无需把类型名写进浏览器 runtime
shim。不要从 `subrunToolUi` re-export conversation store、trace
orchestration 或消息投影实现。

Backend 的 `@plugin/backend/citationSourceRuntime`
是窄来源解析门面：插件传入当前 ToolContext 和 canonical
refs，只能获得 Host 已接纳的 Knowledge/Web 来源 DTO。插件不得自行读取 working
history、EvidenceStore、CitationSnapshot 或历史工具 bundle；需要某一来源子集时，在插件领域内按
`sourceType` 明确接纳。

Backend 的“引用”不允许再放进泛化 `referenceRuntime`：

- `@plugin/backend/blockReferenceRuntime`
  只暴露文档块身份到短 ref 的确定性生成/解析；这种 `#ref`
  是文档内定位符，不是 Citation `[@ref]`。
- `@plugin/backend/textUnitRuntime` 只暴露中文字/英文词单位的模型文本截断。
- Knowledge `PluginDocumentSoT` 属于工具上下文契约，直接从
  `@plugin/backend/toolRuntime` 引用。

`@plugin/renderer/referenceRuntime` 是 Renderer 的引用搜索/UI port，与上述 backend 能力无关；不得因名字相似把
两者重新合并。它的 Web/Manual 表单行为、校验和 `.web-manual-citation-form` 样式由 Editor Citation 的公开
Renderer 合同唯一拥有，Host composition 负责装载 CSS，Mindmap 只通过该 port 消费，不复制样式或 deep import
Editor 内部路径。这是带 Citation 语义的 Host 业务能力，不属于 `@linnya/renderer-ui` 基础组件。

Backend 的 `@plugin/backend/workspaceDatabasePath`
只给 standalone 插件进程解析宿主权威 `workspace.sqlite`
位置；它不暴露 WorkspaceService、VFS、mutation publisher 或数据库连接。既有
`workspaceRuntime` 为兼容旧消费方继续 re-export 该函数，新建的只读 command
adapter 必须直接依赖窄门面，防止把完整 workspace 运行图打进独立制品。

Backend 的 `@plugin/backend/documentImageAsset`
是按文档 ownership 接管图片的窄门面。插件只提交文档 ID 与本地路径或内存 bytes，获得 asset
ID、已复核媒体事实和 data URI；受管路径、`assets`、
`document_asset_links`、存储根与内容完整性校验均留在 Host。该门面按 workspace 数据库装配独立 runtime，不能被扩成通用 asset 查询器，也不能接受“跳过文档归属”的读取参数。

Backend 的 `@plugin/backend/imageTranscoding` 是不透明内存图片转码窄门面。插件提交已经在自身领域完成背景合成的 bytes，以及明确 JPEG quality、chroma subsampling 和输入像素门禁，只取得编码后的 bytes；Host 发现真实透明像素时直接拒绝，不能猜测或静默补入白底。文件路径、Sharp pipeline、asset 登记、Conversation 生命周期和业务默认值都留在各自 owner。该门面不能扩成通用图片 manager，也不能接受“自动选择质量”或静默降级参数。

## 门面设计纪律

- **门面要窄**：只暴露插件真正需要的函数和 DTO，不要 re-export 整个 host
  service 或上帝对象。
- **不挂插件专属函数**：通用能力让插件传自己的 id 调通用接口；`isXxxPluginEnabled`
  这类专属函数禁止出现在通用门面上。`@plugin/backend/pluginRuntime`
  是启停门禁唯一通用入口，插件可在包内用自己的 `pluginMeta.id/name` 做薄封装。
- **插件上下文预算归插件**：树深、节点数、页面数、元素数这类上下文裁剪参数属于具体文档类型的模型可见协议，不放在 host
  conversation config。Host 若要提供预算平台能力，只能提供“按 document
  type 查询/传入预算”的通用接口，不能新增 `getMindMapXxx` / `getSlidesXxx`
  之类函数。
- **隐藏 host 内部 schema**：能力背后是 SQL /
  host 表结构时，SQL 实现留 host，门面只给「解析意图」。否则 artifact 嵌入对 host 表结构的依赖，host 改 schema 时旧版插件直接坏。
- **统一 port 注入模式**：renderer 门面用 port 注册（host
  installer 在 app 层绑定实现），不要直接 import 业务域 store/service。新门面一律走 port，避免插件 artifact 绑定 host 内部 store 结构。
- **临时桥不能沉淀成 SDK**：迁移期的 legacy
  bridge 必须有退出计划，完成后从 resolver 删除并加守卫禁止复活。
- **Core 不拥有具体插件 composition glue**：`src/app-hosts/linnya/plugin-registry/builtin/`
  只静态装配平台 contribution；其他插件由 direct/active/bundled artifact loader
  发现。跨插件集成验收放 `packages/plugins/__tests__`，不能为了源码开发方便把具体插件 backend 重新 import 回 Core。
- **契约方向**：`@linnya/plugin-host-contract` 是契约 owner，host 的
  `src/plugin-sdk/*`
  门面实现这些契约，插件只消费契约包映射。新增契约类型先放契约包，再由 host 门面接线。
- **禁止手写 host 镜像桩**：不要用 `hostImports.d.ts` /
  `rendererHostImports.d.ts`
  复制 host 类型。确有浏览器环境或插件自有引擎声明时，只声明那个外部环境本身，不能镜像
  `@/domains/*`、`src/*` 或 host service。
- **旧 `src/plugin-sdk/api.ts`
  不再是注册入口**：`registerNode/registerCommand/registerAgent`
  是历史空实现，已改为 fail-fast。新插件只通过 backend/renderer
  contribution 或明确的 `@plugin/*` port 注册能力。
- **门面不能只照顾当前插件**：比如本轮把图片资源解析、plugin runtime、workspace
  VFS 解析、structured context
  requirement 都做成通用门面。判断标准很简单：未来另一个重型插件能不能不改 Host 直接复用。
