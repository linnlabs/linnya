# Slides Backend Codegen

`backend/codegen` 是 Slides 的 deck.js
source 能力层，负责读取、编辑、结构化、grep、line slice、source
span、draft 协调，以及把 sandbox 产出的 compose 输入编译为 `DeckSpec`
并交给 coordinator 持久化。

本目录服务 source-based 工作流：AI 通过 `read_file` / `edit_file` / `write_file`
修改 deck.js source，系统负责类型检查、编译、版本写入和 source span 追踪。

## 文档树

```text
codegen/
├── README.md                         # 本说明
├── index.ts                          # backend-codegen 对外导出入口
├── CodegenPresentationService.ts     # read/edit/write/grep/structure/source slices 用例服务
├── CodegenPresentationTypes.ts       # codegen 工具输入输出、port、上下文类型
├── CodegenPresentationError.ts       # codegen 用户可读错误
├── CodegenDeckBuilder.ts             # sandbox compose result -> DeckSpec -> presentation build
├── InitialPresentationDraftCreator.ts # 首次编译失败的 shell + draft 补偿编排
├── createBlankPresentationSource.ts  # 空白 presentation 基线源码纯函数
├── DeckSourceStore.ts                # compiled/draft source 读取与状态判定
├── DeckReadStateRegistry.ts          # conversation 内 read 去重和快照状态
├── PerSlideAssembleCache.ts          # per-slide assemble cache
├── editSourceText.ts                 # old_string/new_string 替换纯规则
├── normalizeCodegenSourceCompatibility.ts # 收窄的 AI 高频笔误准入规范化
├── grepDeckSource.ts                 # deck source grep
├── sourceText.ts                     # source 切片、行号、span 扩展、换行归一化
├── structureDeckSource.ts            # deck source 结构化摘要
├── writeDiagnostics/                 # parser/结构诊断的统一内部合同与纯规则
├── ../features/presentationBuildFailure/ # 构建失败事实、策略与 observation 格式
├── diff/
│   └── formatPatch.ts                # structured patch 输出
└── compose/
    ├── presentationComposeInput.ts   # direct compose input 读取与 DeckSpec 构建
    ├── chartPresets.ts               # chart preset 解析
    ├── inputParsers/                 # table/chart/image/style 等输入 parser
    └── flex-layout/                  # scene graph DSL -> layout boxes -> DeckSpec
```

## 架构与数据流

创建新 deck：

```text
write_file(source)
  -> normalizeCodegenSourceCompatibility()
  -> presentationBuildExecution.typecheckCodegenSource()
  -> 成功：sandbox ppt_compose -> builder -> current + 首个 source checkpoint
  -> 编译/资产/物化失败：
       -> 建立一页空白 presentation shell
       -> exact source 写入 presentation_drafts + VFS text snapshot
       -> 返回 source 保存成功 + buildStatus=draft + typed build failure
  -> document hook -> write_file observation + diagnostics
```

编辑已有 deck：

```text
read_file / source slices
  -> DeckReadStateRegistry
  -> edit_file(old_string, new_string)
  -> replaceSource()
  -> normalizeCodegenSourceCompatibility()
  -> 携带首次读取的 revision id / revision number / source hash
  -> current DeckSpec.theme -> DECK_DESIGN（只读派生锚点）
  -> typecheck + build
  -> writeDiagnostics -> edit_file observation
  -> 成功：current document + 新 source revision，并删除旧 draft
  -> 失败：exact source + VFS text snapshot 更新为 draft，VFS write_file/edit_file 返回 buildStatus=draft
```

source-backed 元素编辑：

```text
renderer source selection
  -> sourceSpan
  -> readSourceSlices()
  -> expandDeckSourceSpanForElementEdit()
  -> edit_file 精确替换
```

## 边界与依赖

- codegen 可以依赖 persistence port、presentation build execution、engine builder
  port 和 shared compose DSL 类型。
- codegen 不负责 sandbox policy；执行作者源码的 `ppt_compose` profile 在
  `backend/sandbox`。TypeScript 虚拟 host 的规则仍在 sandbox 子目录，但生产物理执行必须通过
  `features/presentationBuildExecution`，两种边界不能混称为同一个授权。
- codegen 不直接注册工具、不处理 IPC、不访问 renderer store。
- source 修改必须基于精确 old_string/new_string 或明确的 source
  span，不允许按展示文本猜目标。
- `DeckReadStateRegistry` 只用于去重、可观察性和体验优化，不作为写入授权来源。
- edit/write 必须把 service 首次读到的 revision 和 source
  hash 传给 builder。builder 不得重新把任意 latest
  revision 当成调用方的 base；发生冲突时不保存过时 draft，而是要求重新
  `read_file`。
- 通用 `edit_file` 还会透传 VFS `sourceKey`
  receipt；service 必须在接受替换后全文时先与当前 compiled/draft source
  key 比较，以关闭 VFS exact replacement 与 Slides 写入之间的并发窗口。
- VFS 当前源码由 compiled revision 或绑定该 revision 的 unresolved draft 二选一投影；draft
  存在时它就是 `read_file/edit_file/grep` 的编辑事实。DeckSpec 与 PPTX 仍只代表 current compiled
  revision，不能冒充 draft 已物化成功。
- VFS 默认源码读取只投影持久化事实，不调用 typecheck、`SlideMarkerIndex` 或其他编译派生能力；
  即使 draft 存在语法错误，也必须可读、可检索并可被 `edit_file` 修复。页级/结构化读取继续使用严格索引，错误应由该显式能力报告。
- 首次失败 shell 只建立 presentation identity、revision 和 draft 外键基线。preview/render/inspect/export
  必须拒绝 unresolved draft，不能显示 shell 或旧 compiled checkpoint。
- `DECK_DESIGN` 只能从当前持久化 `DeckSpec.theme`
  派生并注入已有稿件的 sandbox；它不是第二份主题状态，也不能从本机 resolved
  font 反写。

## deck.js 公开 authoring contract

- `src/shared/flexComposeContract.ts` 是 deck.js 场景图的公开类型真值；其中
  `Layout*Config` 表示 Agent 可写输入，`Layout*Node` 还包含运行时只读结构。
- `scripts/codegen/layoutDts/` 从 shared contract、shape geometry 与 sandbox
  globals 生成两份同内容 d.ts：sandbox typecheck 使用一份，Slides
  skill 分发一份。禁止手改生成文件。
- 正式能力必须使用精确类型，不能用 `unknown` 或 `Record<string, unknown>`
  代替 Chart、TableCell、rich run、Image shadow、Theme 等可写结构。
- `chartData/tableData` 与旧 Text aliases 只用于已有 source
  admission；新示例和 skill 不主动生成兼容写法。
- 图表局部颜色只通过 `chartStyle` 表达轴标签、数据标签和网格线；表格顶层
  `border` 只表达整表统一的纯色边框与 pt 粗细。两者都必须进入 DeckSpec 和
  RenderModel 正式字段，再分别投影到 ECharts 与 PptxGenJS；不得塞进
  `chartOptions/tableOptions` 绕过跨端合同。
- Text 的 authoring 宽度语义在 Flex compiler 统一收口：Flex 流或显式
  `width/maxWidth/左右边界` 表示固定宽度并自动换行；绝对定位且没有横向约束时，compiler
  按内容测量并物化盒宽，只保留源码中的显式换行。页码、序号和短标签可省略宽度；正文仍应声明宽度或放入 Flex 容器。
- `radius: 0.5` 仅作为径向渐变中无歧义的 AI 高频笔误在准入层展开为
  `radius: { x: 0.5, y: 0.5 }`。公开类型、生成 d.ts、skill 和新示例仍只描述二维半径；
  动态表达式、其他对象和线性渐变不做猜测性改写。
- `compose({ layout })` 的公开合同由 shared `SlideLayout` 统一拥有：三个 preset
  与 `{ width, height, unit: "in" }` 自定义物理尺寸都必须经过
  `normalizeSlideLayout()`；Direct、Flex、Worker codec、持久化和 PPTX 初始化禁止各自复制校验。
  `"16:9"` 只作为 Direct source 中的高频旧写法规范为 `"16x9"`；其他比例字符串不猜测。
  自定义尺寸按 EMU 规范化，整份文稿共用同一尺寸，deck.js 不支持逐页混用。
- `createBrushArtwork()` 只公开 seed、显式纯色背景、quality 与受控声明式 layers/marks；普通 deck.js
  循环可以构造 marks，但 Worker 不执行作者代码。最终元素盒统一派生 pixel size，runtime 版本和像素
  尺寸不是 authoring 字段。Brush 产物走既有 Image ownership，不能成为新的 RenderNode 或第二套图片
  字节事实。
- `Shape({ type: "path" })` 的 object literal 若把零原点重复写成
  `viewBox: { x: 0, y: 0, width, height }`，准入层只删除这两个零值字段；非零原点、动态表达式和其他
  shape 不改写，公开类型、生成 d.ts 与 skill 仍只描述 `{ width, height }`。
- typed path 的 `close` 表示闭合轮廓，不是所有路径的必填终止符。engine 必须保留不含 `close`
  的开放折线/曲线；不能为了通过物化而自动补闭合命令。
- `_type/children/_sourceSpan/_layoutConstraintEvidence`
  是内部结构，`chartOptions/tableOptions`
  是 DirectCompose/PptxGenJS 内部入口；它们不属于工厂 config，也不能被描述为 deck.js 高级能力。
- Flex compiler 在 `LayoutResult.node + box` 同时可用时派生
  [`generatedLayoutConstraints`](../../shared/generatedLayoutConstraints/README.md)：只传递数值声明、Yoga
  最终盒、比例与 computed 父容器身份。禁止在 quality 重新解析 deck.js 或从最终盒反推声明值；
  imported PPTX 不伪造该事实。
- 新增公开能力必须同时具备：shared config 类型、sandbox
  runtime/compiler 消费、skill
  syntax 或生成 reference 可发现性，以及真实 sandbox → Flex
  compiler 的语义 case。只让源码通过 typecheck 不算交付。

## 开发规范

- 新 deck.js API 或 DSL primitive 先定义 shared `Layout*Config`，再同步
  `backend/sandbox/layoutPrimitives.ts` 与 `compose/flex-layout`
  编译；随后重新生成 d.ts 并补语义验收。
- 新 compose 输入字段必须放到 `compose/inputParsers/` 或明确的 compose
  parser，避免在 builder 中直接读 unknown object。
- 新 source 操作优先实现为纯函数并加业务 case，再接
  `CodegenPresentationService`。
- 可信 typecheck、Flex/Yoga 和 PPTX 构建的物理隔离统一沿
  `presentationBuildExecution` 扩展；禁止在 service 内直接新建 Worker，或因 Worker 不可用静默退回 in-process。
- compose/layout 跨 Worker 只传严格 JSON。Direct 输入保持公开 DTO 后由 App Server 复验；Flex 输出使用专用可信结果读取器恢复内部 text wrap、SVG source 与 generated layout constraint evidence。禁止让普通 compose parser 接受这些内部字段，也禁止用类型断言跳过结果校验。
- `editSourceText.ts` 是 codegen 唯一的 exact
  replacement 规则；不要再建立带相同匹配语义的 service/class。draft 保存、编译和 revision 提交属于
  `CodegenPresentationService` 编排，不属于字符串替换函数。
- 新错误应使用 `CodegenPresentationError`，文案面向 AI 和用户可理解的修复动作。
- 编译链内部必须抛 `PresentationBuildFailureError`；`CodegenPresentationService`
  在 write 边界补齐 `draftSaved`、`presentationId` 和 expected revision。draft 已落盘时 write
  返回 `buildStatus=draft + PresentationWriteFailure`；draft 未落盘、冲突或持久化失败时才包装成
  `CodegenPresentationError`。禁止用 `message.includes()` 推断 phase 或 draft kind。
- 失败 code 的 `retryable/sourceFixable/nextAction` 只能在
  `features/presentationBuildFailure`
  的策略表定义。source 问题要求修改 deck.js；asset store、PPTX
  runtime、persistence 等环境问题要求重试同一 source，不能诱导 Agent 随机改稿。
- PPTX 物化边界必须同时产生安全 `referenceId` 和同 identity 的内部结构化日志；公开 failure
  不得包含 stack、绝对路径或原始 cause，内部日志不得省略 presentation/project 和 materialization
  上下文。
- draft 的 `lastErrorKind` 新写入完整稳定 code（例如
  `slides.codegen.typecheck`）；旧短值只为读取历史数据库保留，禁止继续生成。
- 修改 write/edit 行为时必须同时考虑 compiled source、draft source、read state
  invalidation 和 structured patch 输出。
- `PresentationDraftRepository.upsert()` 必须与 Workspace text snapshot 同事务推进；否则插件关闭后的
  VFS fallback、搜索索引和文件工具会读到空白 shell 或旧 compiled source。
- 初次失败的 shell/draft 是补偿事务：draft 保存失败时先从文件树隐藏刚建节点，再清理 Slides
  自有 presentation/revision/draft 记录。普通用户删除不能调用该补偿接口。
- 正式提交必须同时复用 builder 的 expected-base 前置校验与 repository 的 base
  revision 原子 CAS；禁止单独更新 current materialization、跳过 source
  revision，或从 stale draft 读取 VFS。

## 测试入口

- service：`packages/plugins/slides/src/backend/codegen/__tests__/CodegenPresentationService.test.ts`
- 首次失败补偿：`packages/plugins/slides/src/backend/codegen/__tests__/InitialPresentationDraftCreator.test.ts`
- source store/edit/read
  state/cache：`packages/plugins/slides/src/backend/codegen/__tests__/*.test.ts`
- compose
  parser：`packages/plugins/slides/src/backend/codegen/compose/inputParsers/__tests__/*.test.ts`
- flex
  layout：`packages/plugins/slides/src/backend/codegen/compose/flex-layout/__tests__/*.test.ts`
- codegen
  examples：`packages/plugins/slides/src/backend/__tests__/codegenFirstExamples.test.ts`
- 插件全量：`pnpm run test:plugin:slides`
