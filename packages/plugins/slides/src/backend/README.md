# Slides Backend

`src/backend`
是 Slides 插件的后端 contribution 与业务运行时目录，负责向插件平台注册工具、agent、document
hook、IPC、runtime effect、sandbox profile、owned tables 和迁移，并装配
`PptCoordinator` 承接 source-first 创建/编辑、查询与恢复等用例。

backend 目录可以消费 host 后端平台门面，但不能直接依赖 renderer，也不能把 workspace/DB/IPC 等外部能力下沉到 engine 纯业务层。

## 文档树

```text
backend/
├── index.ts                 # backend contribution 装配入口
├── README.md                # 本说明
├── skillResourceRoots.ts    # Slides skill 资源根目录解析
├── toolManifest.ts          # Slides 工具类、工具名和 agent 工具白名单
├── agents/                  # slides_agent 定义与 prompt
├── capabilities/            # backend 域内跨 feature 的窄技术能力
│   └── typescriptRuntime/   # deck.js AST/typecheck 共用的按需编译器运行时
├── codegen/                 # deck.js source 读写、结构化、compose/flex 编译
├── coordinator/             # PptCoordinator 与 codegen、查询、恢复 runtime
├── documentHook/            # presentation 文档类型 hook、VFS 当前源码 reader 与 runtime
├── engine/                  # PPTX 编译、解析、布局、质量诊断纯业务引擎
├── features/                # 独立业务能力（build execution、source history、图片/SVG 归属、worker、screenshot、inspection、CLI）
├── ipc/                     # Slides IPC 合同、payload 校验、handler 注册
├── persistence/             # presentation / draft repository、schema、migrations
├── sandbox/                 # ppt_compose profile、代码插桩、codegen typecheck
├── toolClasses/             # 工具类导出入口
├── toolContext/             # Slides tool context decorator
└── tools/                   # ppt_plan / ppt_inspect、inspect feedback，以及未向 Agent 暴露的 legacy export 实现
```

`__tests__/`、各子目录测试和 fixtures 是 backend 回归与验收测试，不属于生产装配路径。

## 架构与数据流

backend contribution 装配：

```text
slidesBackendPlugin
  -> toolManifest
  -> agents
  -> documentTypeHooks
  -> ipc.register
  -> runtimeEffects.activateSharedPptCoordinatorRuntime
  -> sandboxProfiles
  -> hiddenWorkers
  -> ownedTables / pluginMigrations
```

Slides 栅格 worker 链：

```text
backend screenshot orchestration
  -> 已授权图片资源物化为 data URI
  -> invokeSlidesRasterWorker
  -> host HiddenWorkerHost
  -> sandboxed renderer worker
  -> shared codec 校验 SlideRasterResult
```

截图输出链：

```text
PptCoordinator.renderScreenshots
  -> 同一版本 render model snapshot
  -> presentationScreenshot 资源物化
  -> slideRasterWorker
  -> PNG 复核 + staging
  -> 按 encoding 整批发布 PNG/JPEG 页面
```

`features/slideRasterWorker/` 只负责 worker definition、dev/prod 路径解析和 host
runtime 调用。worker 生命周期、超时、崩溃恢复、idle
close 与插件禁用后的 dispose 由 host `HiddenWorkerHost`
统一管理。backend 调用方必须先完成资源授权和物化，不能给 preload 增加任意文件读取能力。
普通 Linnya Backend 在自己的 composition 内把带 codec 的 `BackendHiddenWorkerRuntimePort` 组合到
data-only `DesktopHiddenWorkerHostPort`，当前低层 adapter 由 Electron 提供。standalone Electron CLI 与
raster smoke 不经过 App composition，因此只允许在各自构建根显式绑定
`standaloneHiddenWorkerRuntime`；该 composition 复用相同的 Backend codec 层和 Electron Desktop host，
SDK 门面本身不得增加环境探测或隐式 fallback。

路径解析采用显式运行位置，而不是候选搜索：`source-development` 从 workspace
Slides package root 计算 `dist`；`artifact-runtime` 从磁盘 backend 或 standalone
CLI 自身 package root 计算
`dist`。definitions 保存模式与根来源，functions 只做单根路径计算，`process.env`
/ `__dirname` / `process.cwd()` 读取只留在 infrastructure。禁止读取
`LINNYA_PLUGIN_ROOT`、`resourcesPath` 或 `extraResources` 作为 Slides
fallback，也禁止把路径策略放入 engine、coordinator 或 screenshot orchestration。

创建/编辑与查询主链：

```text
source 工具或只读 IPC
  -> PptCoordinator
  -> codegen / query runtime
  -> engine
  -> current document + source revision + workspace projection
```

backend 仍有供内部读取 current PPTX 的 legacy export 实现，但当前不向 Agent 或 Slides CLI 暴露，不属于产品能力。

inspect/反馈主链：

```text
ppt_inspect / Slides CLI inspect
  -> PptCoordinator.inspectPresentation
  -> presentationInspection 同一版本快照与页选择
  -> tools/inspectFeedback 的既有 quality / geometry 事实
  -> Agent observation 或 CLI 机器合同
```

人/CI CLI：

```text
presentationCli 参数适配
  -> PptCoordinator.inspectPresentation / renderScreenshots
  -> inspection JSON 或含逐页 locator 的 render JSON
```

source 写后诊断链：

```text
CodegenDeckBuilder.writeDiagnostics
  -> CodegenPresentationService
  -> documentHook（映射源码行号）
  -> host documentDiagnostics
  -> write_file / edit_file observation
```

TypeScript runtime 链：

```text
backend contribution 注册
  -> 不加载 TypeScript
  -> 第一次 deck.js typecheck
  -> presentationBuildExecution 的长期 Node Worker
  -> capabilities/typescriptRuntime
  -> artifact 自带 node_modules/typescript
  -> Worker 内缓存 compiler runtime 与已解析 lib SourceFile
```

TypeScript 同时服务 `codegen/` 和
`sandbox/` 的源码分析能力，因此编译器加载仍归属 backend 域内 capability；生产 typecheck 的执行生命周期则归
`features/presentationBuildExecution`，不能退回 App Server 调用线程。发布 artifact 只携带
`lib.es2020.d.ts` 的传递引用闭包；构建会执行真实compiler smoke，并同时限制
`index.cjs` 依赖图与整个 backend raw
bytes。禁止恢复静态 TypeScript 值导入，否则插件注册会重新把编译器拉回主进程启动路径。

当前 build execution 已隔离 typecheck、Flex/Yoga compose/layout 与 PPTX/ZIP 物化。生产 coordinator 在调用 Worker 前只完成图片授权/读取与 SVG hidden-renderer fallback，把结果收敛成自包含 DTO；PptxGenJS、OOXML 清理和 JSZip 均在同一个长期 Worker 中执行，并以 transferable `ArrayBuffer` 返回。作者代码仍只在 Profiled Code Sandbox 执行，可信构建 Worker 只消费严格 DTO，也不拥有 DB、Workspace 或文件路径读取能力。

Agent 图片 locator 链：

```text
generate_image / Slides launcher 产出 conversation: locator
  -> ToolContext decorator 调用 workspace runtime 窄门面
  -> host conversation admission 把 locator 解析为受管物理路径
  -> shared PptCoordinator 绑定 resolver
  -> codegen image context 携带 conversationId
  -> Slides image resolver 校验普通文件并交给 engine
```

共享 coordinator 可能先被 IPC 或 document
hook 创建，再由 Agent 工具上下文绑定 conversation
resolver；绑定必须更新现有实例，不能为同一 Database 重建 coordinator，否则会丢失 read-state、draft 和缓存状态。CLI 子进程不经过 ToolContext。launcher 使用 Host 注入的
`LINNYA_CONVERSATION_ROOT` 管理 conversation 输出；直连 CLI 的 `--output`
是普通 OS 路径，stdout 则返回可供 `read_file` 使用的 `file:` locator。

Agent SVG Graphic 链：

```text
createSvgGraphic(inline/local/conversation source)
  -> sandbox / codegen 解析公开合同
  -> engine/svgGraphic 唯一 admission
  -> presentationSvgGraphicOwnership + Host documentSvgAsset
  -> DeckSpec 只保存 owned ref
  -> 单次授权读取形成 RenderModel / PPTX compile context
  -> presentationSvgGraphicFallback 复用隔离 worker 生成透明 PNG
  -> PPTX SVG/PNG 双媒体 hard gate
```

该链不复用 raster image inspector，也不让 renderer、CLI 或 PPTX compiler 回读作者路径。公开
SVG 只表达无文字复杂图形；标题、标签和正文仍由原生 Text 承担。

Brush Artwork 链：

```text
createBrushArtwork(seed + background + quality + declarative layers/marks)
  -> sandbox / codegen 解析公开合同
  -> final Image box 派生 pixel size 与 materialization identity
  -> presentationBrushArtworkGeneration 串行调度 job-scoped WebGL2 Worker
  -> presentationImageOwnership + Host documentImageAsset 接管不透明 PNG
  -> ordinary Image RenderModel / preview / PPTX
```

Brush 不拥有 RenderNode、数据库表或第二套图片 binding。shared codec 统一校验内置 brush、field、fill、
mark 与复杂度预算；Renderer adapter 逐 layer 重置状态并解释局部 0–100 坐标。当前上游不保留透明通道，
因此公开合同要求显式纯色背景；hidden Worker 只消费严格 DTO，不读取 DB、Workspace 或作者源码。

## 边界与依赖

- Slides 主 Agent 的临时研究结论和设计判断保留在当前推理上下文；跨阶段任务只把精简目标、进度和下一步写入 Conversation
  TaskState。只有项目交付物或需要跨协作者复用的材料才写入 Workspace 文档。执行型 Slides 子 Agent 不拥有 TaskState，只通过委派 prompt 接收本次任务。live
  prompt 和 Skill 禁止恢复已退役的 SharedMemory 心智或工具身份。
- backend 可以依赖 `@plugin/backend/*` 平台门面，例如 workspace runtime、plugin
  runtime、tool runtime、sandbox runtime、asset resolution、text
  measurement、font resolution。
- `capabilities/typescriptRuntime`
  只允许 codegen/sandbox 消费；artifact 模式必须从自身
  `dist/backend/node_modules/typescript` 精确加载，不能回退宿主或全局依赖。
- backend 不能 import `src/renderer/**`，也不能依赖 Vue、DOM、Pinia 或 renderer
  store。
- engine 不能直接访问 repository、workspace、IPC 或工具上下文；这些能力由 coordinator 或 backend
  contribution 注入。
- conversation 工作目录 admission 属于 host 生命周期实现，不能进入插件契约；插件只能消费
  `PluginConversationFilePathResolverPort`。
- tools 不能直接改 workspace 或 DB；需要持久化时通过 coordinator / codegen
  service / repository port。
- IPC handler 只做 payload 校验、coordinator 调用和 DTO 返回，不写业务规则。
- persistence 只管理 Slides owned
  tables 和 repository，不承载生成、布局或工具语义。
- `presentation_documents` 每个文稿只保存一行 current
  materialization；`presentation_revisions`
  只保存源码 checkpoint/patch。模板原始 PPTX 属于
  `presentation_templates`，不能与文稿当前 PPTX 混为一谈。
- `presentation_image_bindings` 由 `features/presentationImageOwnership` 拥有，只保存 Slides 源码图片身份到 asset ID 的不可变绑定；asset 登记、文档 ownership 和内容复核必须走 Host 门面。
- `presentation_svg_graphic_bindings` 由 `features/presentationSvgGraphicOwnership`
  拥有，保存 source identity 到 canonical owned SVG asset 的 first-write-wins
  绑定；SVG admission 必须走 `engine/svgGraphic`，实际字节与文档 ownership 必须走 Host
  `documentSvgAsset` 门面。DeckSpec 和 renderer 不得回读原始路径。
- hidden
  worker 只执行 DOM/Konva/ECharts 栅格化或受控 Brush 图片生成，不查询 presentation、workspace 或数据库，也不写输出文件。
- `presentationBuildExecution` 是 Slides 自己拥有的 Node Worker 合同，不是公共插件 compute 接口，也不复用 BrowserWindow `hiddenWorkers`。它不能访问 DB/Workspace，插件停用必须先拒绝新请求并终止 Worker。

## 开发规范

- 新 backend 用例优先放在 `coordinator/`
  的 runtime 或 engine 子模块中，工具类只做用户输入/输出适配。
- 新 tool 名称必须通过 `toolManifest.ts`
  暴露，并补负向/正向测试确认 agent 工具面符合预期。
- 新 IPC 通道必须先改 shared
  IPC 合同，再补 contracts/handlers 测试；当前没有直接 PPTX 文档导入通道。
- 新持久化字段必须同步最终空库 schema、repository 类型和 repository 测试；已发布的 migration 编号和语义不可改写。当前 v3 负责把 v1/v2 的
  `presentation_versions` 历史结构一次性物化为 `presentation_documents` +
  `presentation_revisions`，新库和旧库都必须走同一条 v1 → v2 →
  v3 链；v4 新建源码图片绑定表。完成 v3 后不得再新增 legacy 双读或 fallback。
- 新 sandbox 能力必须先在 `sandbox/`
  定义 profile 或 typecheck 能力，再由 codegen/coordinator 使用。
- 新增 TypeScript 标准库需求时应修改 typecheck 的 canonical `lib`
  合同，让构建脚本从引用关系自动扩闭包；禁止手工复制全部 `lib.*.d.ts`。
- 新 engine 能力不要从 backend 大入口暴露；跨装配层复用时优先走
  `@plugin/slides/backend-engine-core`。
- 新 worker 消息必须先扩展 shared codec，并同步 worker 自检、plugin
  artifact 校验和 app-level registry 集成测试。

## 测试入口

- backend contribution / public
  entrypoints：`packages/plugins/slides/src/backend/__tests__/public-entrypoints.test.ts`
- coordinator：`packages/plugins/slides/src/backend/coordinator/*.test.ts`、`packages/plugins/slides/src/backend/__tests__/ppt-coordinator.test.ts`
- IPC：`packages/plugins/slides/src/backend/ipc/*.test.ts`
- tools：`packages/plugins/slides/src/backend/tools/**/*.test.ts`
- persistence：`packages/plugins/slides/src/backend/persistence/*.test.ts`
- sandbox：`packages/plugins/slides/src/backend/sandbox/**/*.test.ts`
- TypeScript
  runtime：`packages/plugins/slides/src/backend/capabilities/typescriptRuntime/**/*.test.ts`；`build:backend`
  另验证入口不 eager-load、artifact Worker 本地解析和标准库真实编译
- presentation build execution：`packages/plugins/slides/src/backend/features/presentationBuildExecution/**/*.test.ts`；`build:backend` 另执行真实 Worker artifact smoke
- hidden
  worker：`packages/plugins/slides/src/backend/features/slideRasterWorker/**/*.test.ts`
  与 app-level plugin registry 集成测试
- screenshot：`packages/plugins/slides/src/backend/features/presentationScreenshot/**/*.test.ts`
- 真实 Electron
  worker：`pnpm --dir packages/plugins/slides run smoke:raster-worker`；覆盖真实系统字体查询、deck.js 主题字体进入 RenderModel、共享文本布局和中英文 PNG 可见性
- Shape Geometry
  writer/parser：`packages/plugins/slides/src/backend/engine/shape/pptxShapeGeometryAdapter.test.ts`
  与 `engine/parser/xml/ShapeVisualParser.test.ts`
- SVG Graphic 公开纵向链路：`codegen/__tests__/SvgGraphicCodegen.integration.test.ts`、
  `__tests__/create-ppt-coordinator.integration.test.ts`、`engine/DeckAssembler.test.ts`
- SVG Graphic fallback / PPTX 回读：`features/presentationSvgGraphicFallback/**/*.test.ts`、
  `engine/svgGraphic/pptx/svgGraphicPptxRoundtrip.test.ts`
- 插件全量：`pnpm run test:plugin:slides`
