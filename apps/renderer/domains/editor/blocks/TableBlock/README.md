# TableBlock 功能说明

## 功能概述

TableBlock 是基于 Tiptap 实现的表格编辑功能，为编辑器提供轻量级、高性能的表格编辑和Ai体验。
任何对tableblock模块的更新，最终都需要更新本文档。

## 单元格选中柄定位

单元格左上角选中柄使用视口坐标定位，必须保持以下约定：

- `TableCellHandleOverlay` Teleport 到 `body`，与 `getBoundingClientRect()` 保持同一坐标系。
- 不能把 `position: fixed` 的选中柄留在带 `transform` 的 pane 内；即使是 `translateX(0)`，祖先也会建立新的 fixed containing block，造成右侧文档 pane 中的横向偏移被重复计算。
- `useTableCellHandlePosition` 只负责测量时机和位置状态，不读取 app layout store。滚动、编辑器尺寸变化、祖先 class/style 变化以及祖先布局过渡统一合批到 animation frame。
- 祖先 `transform` 过渡不会触发 `ResizeObserver`，过渡期间需要逐帧测量；handle 隐藏或组件卸载时必须释放 frame、监听器和 observer。
- `TableInteractionManager` 只负责把 ProseMirror 插件状态投影为 Vue props，以及把 handle 的 mousedown 转换为 `CellSelection` 事务。

测试覆盖：

- `ui/composables/useTableCellHandlePosition.test.ts`：视口坐标换算、单元格内部位置解析、祖先 transform 过渡逐帧跟随、pane 属性和编辑器尺寸变化后的重测量。

## 近期重要架构调整（Table AI 模式 UI 稳定性根因修复）

### 1) 背景：为什么会出现“概率性不消失/不显示”

历史实现中，“是否显示表格坐标栏（行/列）”依赖 `aiIntegrationEventBus` 的 ENTER/EXIT **瞬时事件**。
当组件存在重挂载、退出流程存在异步阶段（例如撤销列添加等待 `docChanged`）、或 UI 布局动画触发重排时，
会出现“丢事件 → 状态不同步”，导致：

- 坐标栏有概率不关闭（仍停留在旧状态）
- 选中柄有概率不显示（被坐标栏互斥隐藏）

### 2) 当前方案：Editor 模式会话驱动 + 插件互斥（高内聚/低耦合）

为消除上述结构性不稳定，本模块已切换为：

- **模式会话（单一数据源）**：`domains/editor/features/table-ai-mode/`
  - 用 `off / active / closing` 表达完整生命周期，而非依赖瞬时事件或多份布尔量
  - 会话持有 `sessionId` 与稳定表身份；异步关闭只结算创建时的会话
  - Editor/TableBlock 通过同域只读 selector 驱动坐标栏、工具栏互斥和虚拟化保活

- **PM 插件互斥（模式机）**：`TableCellInteractionExtension` 增加 `suspended`
  - AI 模式期间暂停单元格交互（强制隐藏 handle/装饰、禁止交互状态变更）
  - 退出 AI 模式时，插件基于当前 selection 自动恢复 handle（无需 Vue 层 restore 式补偿）

### 3) 列引用高亮职责收敛

列引用状态和表格高亮现在都属于 `table-ai-mode` feature：状态更新后由同 feature 的 orchestration
直接应用 Decoration，并携带 `sessionId` 校验当前会话，不再经过全局事件总线。UI 显隐同样以
Editor 模式会话的 `active` selector 为准。

### 4) 当前 Table AI 全链路边界

- TableBlock 只提供 Editor 内的表格节点、坐标、选择、高亮和原子写入能力。
- `domains/editor/features/table-ai-mode/` 持有模式会话、列引用颜色与激活态；`table-fill-write/` 持有行计划和 FIFO 写回 session。
- `app/workflows/table-fill/` 是唯一跨域编排点：把 Editor 的公开 contract 适配为 Conversation Input Extension，并发起系统 forced `subrun_batch`。
- Conversation 只提供通用输入扩展、引用、工具卡挂载与 subrun 展示，不导入 TableBlock、table mode 或 table-fill workflow，也不保存表格坐标和 PM 上下文。
- 旧 `tableAssistantStore`、`tableAiUiBridge`、conversation table integration、全局列颜色 Map 和 AI event bus 均已删除；不得以兼容层或转发事件的形式恢复。

## RootBlock 渲染虚拟化兼容

TableBlock 是虚拟化改造里风险最高的块之一。原因很直接：表格交互大量依赖真实 DOM，包括单元格坐标测量、行列坐标轴、CellSelection、键盘导航和横向滚动容器。如果所在 rootBlock 被替换成 placeholder，这些逻辑拿到的 DOM 就会失真。

当前已接入第一层保活协议：

- **位置解析工具**：`features/RenderVirtualization/state/positionKeepAlive.ts`
  - 输入 `tablePos` / `cellPos` / 任意 ProseMirror position
  - 只读取 doc 结构，向上找到外层 `rootBlock.attrs.id`
  - 不读取 DOM，不依赖 TableBlock 内部实现
- **表格 UI 保活桥**：`ui/composables/useTableRenderVirtualizationKeepAlive.ts`
  - 坐标轴显示时，用 `tablePos` 声明所在 rootBlock 的 `interaction-open` 保活
  - 单元格 handle 显示时，用 `activeCellPos` 声明所在 rootBlock 的 `interaction-open` 保活
  - Editor 重建或文档切换时，会先向旧 editor DOM 成对释放，再向新 DOM 申请保活
- **跨块进入表格**：`tableNavigators.js`
  - 从普通块方向键进入表格时，不再直接 `TextSelection.create(...).scrollIntoView()`
  - 改为走 `positionTextSelectionWithHandshake`，先 hydrate 目标 rootBlock，再设置表格内部光标
- **接入点**：`ui/TableInteractionManager.vue`
  - 只负责把当前表格交互位置传给 composable
  - 不直接调用虚拟化 controller，保持 TableBlock 与 RenderVirtualization 低耦合
- **坐标轴二次测量**：`ui/TableCoordinateHeaders.vue`
  - 坐标轴可能先于 hydrate 完成而首次拿不到 `nodeDOM(tablePos)`
  - 现在会监听 RenderVirtualization transaction，在 placeholder 切回 hydrated 后重绑横向滚动容器 / DOM observer 并重新测量
  - 列宽 / 行高 / 容器位置测量已收口到 `ui/composables/tableCoordinateHeaderMetrics.ts`
  - 列宽 / 行高测量会先按 TableMap 覆盖关系收集真实 cell；优先使用非跨列/非跨行 cell，只有没有更好候选时才把跨列/跨行 DOM 尺寸按跨度均分
  - 坐标轴会话、滚动监听、resize、PM transaction、MutationObserver 生命周期已收口到 `ui/composables/useTableCoordinateHeaderController.ts`
  - 列标/行标定位样式已收口到 `ui/composables/tableCoordinateHeaderStyles.ts`，子组件只消费 controller 测量结果，不再持有自己的 scrollContainer autoUpdate，避免 hydrate 后盯住旧 DOM
  - 侧栏开合 / 宽度变化期间的逐帧测量已收口到 `ui/composables/useTableCoordinateHeaderLayoutSync.ts`，组件只负责 props 接线和子组件渲染
  - 监听器 setup 由 controller 做幂等处理；侧栏同步器会取消旧 rAF 会话，避免快速开合侧栏时旧动画帧继续改写坐标头位置
- **列宽拖拽保活**：`extensions/TableColumnResizeExtension.js`
  - resize handle mousedown 时，从 DOM 找到外层 `rootBlock.attrs.id`
  - 使用独立 `table-column-resize` reason 声明保活，避免与坐标轴 / toolbar 的 `interaction-open` 互相释放
  - mouseup / blur / plugin destroy 会成对释放，拖出编辑器外也不会残留 pin
- **TableInfo 身份刷新**：`position/tableIdentity.ts`
  - Table 自身没有稳定 id，长期持有裸 `tablePos` 会在表格前方插入/删除 rootBlock 后漂移
  - 现在 Table AI / 坐标轴 / 高亮装饰会把外层 `rootBlockId` 作为稳定身份，刷新时优先用它在最新 doc 中重新定位 table，再更新 `node/pos`
  - 旧上下文没有 `rootBlockId` 时仍按 `pos` 校验，保持兼容

测试覆盖：

- `features/RenderVirtualization/state/positionKeepAlive.test.ts`
- `position/tableIdentity.test.ts`
- `ui/composables/useTableRenderVirtualizationKeepAlive.test.ts`
- `tableNavigators.test.js`
- `tableKeys.test.js` 覆盖 `Enter` / `Tab` / `Shift+Tab` 的单元格内选区落点，以及 `ArrowDown` 的边缘检测 / posAtCoords 成功 / 自定义几何回退
- `position/tableNodeAtCoords.test.js` 覆盖嵌套 inline 文本、垂直空白 Y 坐标夹回真实文本行、caret 结果越界拒绝
- `extensions/TableCellInteractionExtension.test.js` 覆盖 DOM 事件 target 归一化
- `features/RenderVirtualization/state/renderVirtualizationPlugin.test.ts` 覆盖 `CellSelection` 保活外层 rootBlock
- `extensions/tableColumnResizeKeepAlive.test.js` 覆盖列宽拖拽保活的 blockId 解析、首列忽略、拖拽开始 pin 和全局 mouseup release

### Table AI 上下文治理

Table AI 的危险点不在“按钮点击”，而在点击后侧边栏会长期持有表格上下文；这期间用户可能滚动远离表格，RootBlock 可能被 placeholder 替换，输出列插入还会改变表格结构。因此上下文不能继续散落在 UI 组件里临时拼。

当前规则：

- `tableAiSelectionContext.ts` 是 Table AI 选区上下文的纯逻辑入口，不依赖 Vue / Pinia / DOM
- 当前选区是 `CellSelection` 时，从最新 `editor.state.doc` 重新读取 table node，并把 `selectedRect(state)` 拍平成纯 `{top,bottom,left,right}` DTO，避免 PM 内部 `map/table/tableStart` 泄漏进 store
- 当前选区已离开表格时，只允许使用保存的 `tableInfo.rootBlockId/tableInfo.pos + originalRect`，并且必须先在最新 doc 中重新定位 table；有 `rootBlockId` 时优先用 rootBlockId，旧上下文才回退到 pos
- 输出列插入后的 `rect/outputRect` 修正由 `correctRectsAfterOutputColumnInsertion` 统一处理，不再由 UI 层自己重复实现坐标偏移
- Table AI 模式激活期间，`useTableAiInteraction.ts` 会按模式会话的稳定表身份声明 `table-ai` 保活租约；这个 reason 独立于坐标轴 / toolbar 的 `interaction-open`，避免两个交互互相释放 pin
- `tableCellWriteOperation.ts` 是正式 `features/table-fill-write` 使用的原子写入能力：每次写入前按 `rootBlockId` 从最新 doc 重定位 table，并且只在真实 dispatch 成功后推进 append tracker
- `write_to_table` 的追加状态按 `row:col` 记录，而不是只按行记录；这样未来工具显式指定 `col` 时，不会把另一列的“已追加”状态串过来
- `TableSelectionDecoratorExtension.js` 的持久选区、输出列和列引用装饰也按 TableMap 覆盖关系解析 cell；同一个 rowspan / colspan 物理 cell 只生成一个装饰，并把多个逻辑格子的边界 class 合并到同一个节点上
- `tableCoordinateUtils.js` 的 Excel 风格坐标定位和表头读取也走 TableMap 覆盖关系；`B1` 落在 `A1:B1` 跨列表头内时，返回的是覆盖该逻辑坐标的真实表头 cell
- `insertOrAppendTextInCell` 的实际实现位于 `ai/tableCellWriter.js`，它只负责单元格写入；`ai/tableAiUtils.js` 继续 re-export 该 API 以保持旧调用路径稳定
- `ai/tableRowProcessing.js` 只保留 `constructPromptForRow/getRowDataContext` 两个行级纯能力；批量遍历由 app workflow 请求前一次性完成
- Table AI 写表、逐行 prompt / row context 和表格填充都会通过 `position/tableMapUtils.js` 的 `getCellOffsetAtLogicalPosition` 读取逻辑坐标覆盖的真实物理 cell；合并单元格后不能再把逻辑列索引当作 `rowNode.child(index)`
- `insertOrAppendTextInCell` 会返回真实写入结果；只有成功 dispatch 后，`TableFillWriteRuntime` 才会更新追加状态，避免越界 / 不可编辑 / 表格结构变化时误判成功
- 历史 JS 边界通过最小 `.d.ts` 类型端口进入 TS，`useTableAiActions.ts` / `TableSimpleToolbar.vue` 不再直接承接隐式 `any`
- `ToolbarDropdown.vue` 显式声明 `trigger` slot 和菜单值类型；来自 `CustomSelect` 的未知值会先校验为字符串再派发给表格 toolbar 命令
- toolbar-facing 命令封装通过 `commands/tableCommandChainRunner.js` 统一读取 `chain().run()` 的真实返回值；虚拟化 / selection 不满足导致命令 no-op 时，不能再被误报为成功
- `splitCell` 只有在原生命令真实执行成功后才安排 `fixTableCellContents`，避免失败路径继续触发异步修复副作用
- 单元格内容结构规范化收口到 `commands/tableCellContentNormalization.js`：命令层只触发结构事务，纯模块负责扫描空 cell、旧版非标准子节点、多个 `tableCellContentBlock`、缺失 id / blockType 的内容块，并统一收敛为一个语义 `tableCellContentBlock`
- 合并单元格的多内容块拼接规则继续由 `commands/tableCellContentAggregation.js` 提供；它作为规范化模块的聚合内核，不直接耦合 toolbar / Vue / DOM

测试覆盖：

- `ui/composables/tableAiSelectionContext.test.ts`
  - 当前 `CellSelection` 刷新最新 table node
  - 保存上下文只在 table pos 仍有效时可用
  - 保存上下文含 `rootBlockId` 时，旧 table pos 漂移后仍能定位到最新 table
  - 非法 rect / 失效 table pos 会显式失败
  - 输出列插入后的选区与输出列坐标修正
- `ui/composables/useTableRenderVirtualizationKeepAlive.test.ts`
  - 验证 Table AI 可以使用独立 `table-ai` reason 申请 / 释放保活
- `extensions/TableSelectionDecoratorExtension.test.js`
  - 验证 colspan / rowspan 下持久选区和列引用装饰会去重到真实覆盖 cell，并保留合并后的逻辑边界 class
- `features/table-fill-write/__tests__/tableFillWriteRuntime.test.ts`
  - 验证 write command、占位符替换、多 unit FIFO、位置漂移重定位、单项失败继续、取消边界和真实 ProseMirror transaction
- `app/workflows/table-fill/__tests__/executeTableFillRun.test.ts`
  - 验证 live `subrun_trace` 写回、父结果完整性校验、失败收尾和显式 session 取消
- `ai/tableCellWriter.test.js`
  - 验证逻辑坐标落在 rowspan 覆盖区时，会写入覆盖该坐标的物理 cell，而不是当前行的第一个 child
- `ai/tableRowProcessing.test.js`
  - 验证逐行 prompt 替换、row context 构造、行失败继续后续行、外层 abort 预先中止
  - 验证逐行上下文读取 rowspan 覆盖区时使用真实覆盖 cell 内容
- `toolbar/tableToolbarSelection.test.ts`
  - 验证文本选区提升为 `CellSelection`
  - 验证多单元格选区在“上方插入行”前按 TableMap 覆盖关系收缩到左上角真实单元格
  - 验证选区无法提升为 `CellSelection` 时不会继续执行 toolbar 命令
  - 验证 toolbar 命令失败会返回 false，不把异常抛回 UI
- `commands/tableCommandWrappers.test.js`
  - 验证插入 / 删除 / 对齐 wrapper 会向上传递 `chain().run()` 的真实失败结果
  - 验证列插入失败时仍会成对清理 command executing 状态
  - 验证 `splitCell` 失败时不会安排后续内容结构修复
- `commands/tableCellContentAggregation.test.js`
  - 验证多个 `tableCellContentBlock` 能聚合为单一内容块，并保留自然空格边界
  - 验证单事务聚合多个 cell 时从后往前替换，不因前一个替换改变后续位置
  - 验证聚合入口使用最新 editor state dispatch，避免命令层自己持有旧位置
- `commands/tableCellContentNormalization.test.js`
  - 验证空 cell、旧版 paragraph 子节点、多个内容块、header cell 属性缺失都能通过同一事务规范化
  - 验证规范化入口使用最新 editor state dispatch，避免 split / merge 后的异步修复沿用旧状态
  - 验证已满足结构不变量的 cell 不产生无意义事务
- `commands/tableColumnDeletion.test.js`
  - 验证按逻辑列索引删除 colspan 内部列时，只缩减目标列，不误删整个跨列 cell
  - 验证 `deleteColumnByIndex` 不再通过 `CellSelection` 中转，避免 Table AI 撤销输出列时扩大删除范围
- `commands/tableFillTargets.test.js`
  - 验证批量填充按 TableMap 逻辑坐标解析目标 cell，colspan / rowspan 场景不会写错物理 child
  - 验证 rowspan 覆盖多行时同一个物理 cell 只会被填充一次
- `commands/tableCoreOperations.test.js`
  - 验证多单元格选区收缩到左上角后，“上方插入行”会插入到用户期望的第一行之前
  - 验证“右侧插入列”会保持每行矩形结构，并把光标落回新列的 `tableCellContentBlock`
  - 验证合并后的 colspan 单元格场景：插入点落在 span 内会扩展 colspan，落在逻辑右边界才插入新的物理 cell
  - 验证合并后的 rowspan 单元格场景：插入点落在 span 内会扩展 rowspan，新行只创建未被跨度覆盖的物理 cell
- `ui/tableToolbarUtils.test.js`
  - 验证 toolbar 定位只接受 `CellSelection`
  - 验证主路径按 TableMap 覆盖关系解析左上角真实单元格，并使用该单元格 DOM rect
  - 验证目标 rootBlock 仍是虚拟化 placeholder 时不调用 `coordsAtPos`
  - 验证 `nodeDOM` 不可用时退到 `coordsAtPos`，双失败时返回 null
- `ui/composables/useTableCoordinateHeaderController.test.ts`
  - 验证坐标轴 controller 能测量列宽/行高/表格位置，并绑定横向滚动容器
  - 验证 tableInfo / editor 变化时 PM transaction 监听保持幂等，隐藏时成对清理
  - 验证 render-virtualization transaction 替换表格 DOM 后，会解绑旧横向滚动容器并绑定新容器
- `ui/composables/tableCoordinateHeaderMetrics.test.ts`
  - 验证坐标轴列宽读取 colspan 内每列独立 `colwidth`
  - 验证 DOM 测量优先使用非跨列/非跨行 cell，避免把跨列/跨行总尺寸直接当作单列/单行尺寸
- `position/tableCoordinateUtils.test.js`
  - 验证 Excel 坐标和表头读取在 colspan 场景下返回覆盖该逻辑坐标的真实 cell
- `ui/composables/tableCoordinateHeaderStyles.test.ts`
  - 验证列标冻结、横向滚动偏移、无 scrollContainer 隐藏、行标高度裁剪
- `ui/composables/useTableCoordinateHeaderLayoutSync.test.ts`
  - 验证侧栏显隐期间逐帧测量、宽度变化合批、旧动画帧取消

尚未宣称完成的深水区：

- 表格内部 `ArrowUp` / `ArrowDown` 跨 cell 的真实 Chromium 坐标场景。核心算法已有 Vitest 覆盖，但浏览器 selection / layout / caret API 仍需要 E2E 验证
- `TableMap` 快照与 hydrate 后 transaction 状态同步
- AI 输出列插入、撤销、列引用高亮期间的远距离滚动与坐标重算。当前选区上下文和写表执行器都已改为读取最新 doc，但“侧边栏打开后滚远再写表/取消”的浏览器场景仍需要 E2E
- 用户滚动远离表格后继续写表 / 取消 / 撤销的行为一致性。保活租约已接入，真实 Chromium 场景仍要补 E2E
- `TableSimpleToolbar.vue` 的 selection 入口和定位 fallback 已有单测；定位逻辑已经识别虚拟化 placeholder rootBlock，目标块未 hydrate 时直接等待下一次定位，不再对占位块内部位置调用 `coordsAtPos`；下一步仍要补真实命令层集成测试，尤其是多单元格选区下插入/删除/合并后的文档结构
- `TableCoordinateHeaders.vue` 的测量内核已拆到 `tableCoordinateHeaderMetrics.ts`，监听生命周期已拆到 `useTableCoordinateHeaderController.ts`，Column/Row 定位样式已拆到 `tableCoordinateHeaderStyles.ts`，侧栏动画联动已拆到 `useTableCoordinateHeaderLayoutSync.ts`；逻辑坐标覆盖关系已有单测，后续应补真实 Chromium 下拖拽列宽 / 远距离滚动 / hydrate 后定位的 E2E
- 列宽拖拽保活协议已接入；真实 Chromium 下仍需要验证拖出编辑器外释放、拖拽过程坐标轴实时测量与虚拟化 pin 的联动
- RootBlock schema 已拒绝解析虚拟化 placeholder 外壳，避免离屏占位 DOM 被粘贴回真实文档；但外部粘贴表格命中 placeholder DOM 的真实 Chromium 剪贴板路径仍需要 E2E 验证

后续所有表格命令改造都必须先判断入口类型：`blockId`、`pos`，还是当前 hydrated 块内本地交互。不能对可能处于 placeholder 的位置直接执行 `nodeDOM(pos)`、`coordsAtPos(pos)` 或 `setSelection(...)`。

## 节点结构

表格采用轻量化设计，主要节点结构为：

```
table (顶级表格节点)
 └── tableRow+ (一行或多行)
      ├── tableHeader* (表头单元格，仅用于第一行)
      │    └── tableCellContentBlock (单元格内容容器)
      │         └── inline* (文本和行内格式)
      └── tableCell* (普通单元格)
           └── tableCellContentBlock (单元格内容容器)
                └── inline* (文本和行内格式)
```

**横向滚动实现**：通过纯 CSS 方案实现，利用 RootBlock 的 `.root-block > .content` 容器作为滚动容器，无需额外的包装节点。详见 `apps/renderer/app/styles/layout/block-layout.css`。

### 核心节点特性

1. **table**
   - 属性: `id`, `blockType: 'table'`, `withHeaderRow: boolean`
   - 内容模型: `tableRow+`

2. **tableRow**
   - 内容模型: `(tableHeader | tableCell)+`

3. **tableHeader / tableCell**
   - 属性: `colspan`, `rowspan`, `colwidth`
   - 内容模型: `tableCellContentBlock`

4. **tableCellContentBlock** (关键创新点)
   - 属性: `id`, `blockType: 'tableCellContent'`
   - 内容模型: `inline*` (仅允许文本和行内标记)
   - 特性: 轻量级、只支持内联内容、适合AI数据处理

## 目录结构

```
apps/renderer/domains/editor/blocks/TableBlock/
├── TableBlock.js              - 表格主节点定义
├── TableCellContentBlock.js   - 单元格内容节点定义
├── TableCell.js               - 扩展tableCell节点
├── tableKeys.js               - 键盘处理函数(Tab/Enter等)
├── tableNavigators.js         - 表格导航处理器
├── index.js                   - 导出表格扩展
├── ColumnReferenceNode.ts    - Conversation composer 使用的列引用 inline atom
├── integrations/
│   └── setup.js              - 向 table-ai-mode 高亮 runtime 注册 Editor 实例
├── extensions/
│   ├── TableToolbarExtension.js - 表格工具栏扩展
│   ├── TableCellInteractionExtension.js   - 单元格交互扩展
│   ├── TableColumnResizeExtension.js     - 表格列宽度调整
│   ├── TableSelectionDecoratorExtension.js - 表格选区装饰器扩展
│   ├── TableKeyboardExtension.js         - 表格键盘扩展
│   ├── TableVerticalNavigationState.ts   - 表格垂直导航状态插件(该文件为ts文件)
├── doc/
│   └── table-ai-mode-ui-refactor-plan.md - Table AI 模式 UI 稳定性根因修复与重构方案（评审/落地记录）
├── ai/
│   ├── tableAiUtils.js        - 表格AI数据提取、序列化与单元格写入兼容出口
│   ├── tableRowProcessing.js  - 指定行 prompt / row context 纯函数
│   ├── tableCellWriter.js     - 表格单元格写入边界，按 TableMap 逻辑坐标解析目标 cell 并 dispatch 写入 transaction
│   └── tableCellWriteOperation.ts - 按稳定表身份执行原子写入并维护 append 状态
├── position/                  - 位置与导航工具
│   ├── index.js               - 工具集中导出
│   ├── tablePositionUtils.js  - 基础位置解析工具
│   ├── tableMapUtils.js       - TableMap相关操作
│   ├── tableSelectionUtils.js - 选区相关工具
│   ├── tableNavigationUtils.js- 光标导航功能工具
│   ├── tableNodeAtCoords.ts     - 表格节点位置计算工具(该文件为ts文件)
│   └── tableCoordinateUtils.js- 坐标系统工具
├── utils/                     - 表格工具函数
│   └── tableContentUtils.js   - 表格内容工具，获取表格和选区的内容
├── commands/                  - 表格操作命令
│   ├── tableCoreOperations.js  - 表格核心操作命令
│   ├── tableToolbarCommands.js  - 表格插入行列命令
│   ├── tableDeleteCommands.js   - 表格删除行列命令
│   ├── tableAlignCommands.js    - 表格对齐命令
│   ├── tableCellCommands.js     - 表格单元格命令（合并/拆分）
│   ├── tableFillCommands.js     - 表格填充命令（一次性填充）
│   ├── tableFillTargets.js      - 填充命令的逻辑行列到真实 cell 内容范围解析
│   ├── registerTableCommands.js - 注册表格命令
│   └── index.js                 - 命令集中导出
├── styles                     - 表格样式定义
│   ├── table.css              - 表格本体、选区、输出列和列引用高亮样式
│   ├── TableAiContext.css     - 输入框上方 Table AI 上下文样式
│   └── TableCellContentBlock.css - 单元格内容样式CSS
├── ui/                        - 表格UI相关组件
│   ├── TableFloatingToolbar.vue - 表格浮动工具栏
│   ├── TableCellHandleOverlay.vue - 单元格处理覆盖层
│   ├── TableInteractionManager.vue - 表格交互管理器
│   ├── TableColumnHeaders.vue     - 列标组件
│   ├── TableCoordinateHeaders.vue - 坐标标组件
│   ├── TableRowHeaders.vue        - 行标组件
│   ├── tableToolbarUtils.js     - 表格工具栏工具函数
│   ├── FloatingToolbar/         - 浮动工具栏子组件
│   │   ├── AiToolbarSection.vue  - AI功能区块
│   │   ├── ToolbarButton.vue     - 工具栏按钮
│   │   ├── ToolbarGroup.vue      - 工具栏分组
│   │   ├── ToolbarDropdown.vue   - 工具栏下拉菜单
│   │   └── DebugToolbarSection.vue   - 调试工具栏组件
│   ├── config/                  - 配置文件
│   │   └── toolbarMenuConfig.js - 工具栏菜单配置
│   └── composables/             - 组合式函数
│       ├── types/
│       │   └── tableAiTypes.ts   - 表格AI类型定义
│       ├── useTableAiInteraction.ts # 组合入口：整合所有use*模块，提供完整交互API
│       ├── useTableAiActions.ts     # AI操作（填充/分析）：选区校验、列添加、装饰设置、侧边栏模式启用
│       ├── tableAiSelectionContext.ts # Table AI 选区上下文纯逻辑：刷新 table node、校验 rect、修正插列坐标
│       ├── useTableCellHandlePosition.ts # 单元格选中柄视口定位与布局变化同步
│       ├── useTableOutputRect.ts    # 输出区域UI工具：验证、描述、等（创建逻辑已合并到 shared）
│       ├── useTableRenderVirtualizationKeepAlive.ts # 表格浮层/坐标轴渲染虚拟化保活桥
│       ├── useToolbarPositioning.js # 工具栏定位：监听选区、计算工具栏位置
│       └── useToolbarState.js       # 工具栏状态：菜单开关、按钮可用性（合并/拆分/新增/删除等）

/apps/renderer/
├── domains/editor/features/
│   ├── table-ai-mode/         - 模式会话、列引用解析/颜色、Decoration 编排与窄 selector
│   └── table-fill-write/      - 行计划和 ProseMirror FIFO 写回边界
└── app/workflows/table-fill/  - Conversation Input Extension 与批量执行编排
```

## 关键功能

### 1. 基础表格编辑

表格提供基础编辑能力，包括：
- 创建具有指定行列数的表格
- 单元格内容编辑，支持文本和行内格式
- 支持表头行设置

### 1.1 外部表格粘贴：统一为默认样式（去除原有边框/字体）

从 Word/网页/Excel 等来源粘贴表格时，剪贴板 HTML 往往会携带外部的 inline style 或 `<style>`，
导致表格出现“原有线框、字体、颜色”等样式污染，与我们新建表格的默认样式不一致。

当前策略为在粘贴链路的输入端做一次清洗：
- **仅当剪贴板 HTML 包含 `<table>`** 时接管粘贴
- **移除表格子树内的 `style/border/width/font...` 等表现层属性**，并移除片段内 `<style>`
- 通过 ProseMirror 原生粘贴管线（`transformPastedHTML` / `transformPasted`）在“解析前/解析后”做归一化，最终样式完全由 `styles/table.css` 控制
- 解析后的 Slice 会复用 `commands/tableCellContentNormalization.js`，把外部粘贴产生的空 cell、旧版 paragraph 子节点、多个内容块、缺失 id / blockType 的内容块统一收敛为单一 `tableCellContentBlock`

实现位置：
- `apps/renderer/domains/editor/blocks/TableBlock/extensions/TablePasteSanitizerHandler.ts`
- `apps/renderer/domains/editor/blocks/TableBlock/extensions/TablePasteExtension.ts`（注册 ProseMirror 粘贴钩子）
- `apps/renderer/domains/editor/blocks/TableBlock/extensions/TablePasteSanitizerHandler.test.ts`

### 2. 键盘导航

通过 `TableBlockExtension` 和 `tableKeys.js` 实现直观的键盘导航：
- `Tab` - 移动到下一个单元格，到最后一个单元格时自动新增一行
- `Shift+Tab` - 移动到上一个单元格
- `Enter` - 移动到下一行同列单元格，在最后一行时退出表格
- `ArrowUp` - 在第一行时支持导航到上方表格的同列最后一行

实现标准：

- 所有 `TextSelection` 必须落在 `tableCellContentBlock` 的 inline 内容区域内，不能落在 `tableCell` / `tableHeader` 容器边界。
- 单元格末尾位置统一通过 `getCellContentBlockPositions(...).contentEnd` 计算；不要用 `cellPos + 1 + cellNode.content.size` 这类容器边界公式。
- `tableKeys.test.js` 会验证 `Enter`、`Tab`、`Shift+Tab` 的最终 selection parent 必须是 `tableCellContentBlock`，防止虚拟化 hydrate / selection 恢复时把旧的非法落点重新带回来。

### 高级键盘导航：保持垂直移动时的水平位置

这是一个在许多富文本编辑器中都极具挑战性的功能。我们成功实现了一个强大的解决方案，以确保在表格中通过 `ArrowUp` 和 `ArrowDown` 键进行垂直导航时，光标能智能地保持其水平位置（X坐标），而不是简单地跳到目标单元格的开头。

#### **挑战：跨节点的"目标X坐标"丢失问题**

ProseMirror 内部拥有一种名为 `goal-x` 的机制，用于在单个连续的文本块内垂直移动光标时"记住"理想的水平位置。然而，当光标需要跨越不同的独立块节点时——例如从一个 `tableCell` 移动到另一个——这个 `goal-x` 状态默认会丢失。这导致光标被放置在目标单元格内容的最开始处，造成了不连贯的、"跳跃"式的编辑体验。

#### **解决方案：手动模拟并扩展 `goal-x` 机制**

我们的解决方案通过一套精巧的、分层演进的机制，手动地在表格范围内模拟并扩展了 `goal-x` 的行为，并最终解决了多行、混合行高等复杂场景下的导航难题。

**第一层：基础的“多点探测”与状态追踪**
1.  **状态追踪插件 (`TableVerticalNavigationState.ts`)**
    *   我们创建了一个全新的、轻量级的 ProseMirror 插件，其唯一职责就是追踪和管理光标的"最后有效X坐标" 
    (`lastGoodX`)。
    *   该插件通过 `appendTransaction` 钩子，能够智能地监听所有非垂直导航引发的选区变化（如鼠标点击、左右移
    动、输入文字等）。
    *   一旦监听到这类变化，它会自动计算当前光标的屏幕X坐标，并将其存储在插件的 state 中。这确保了 
    `lastGoodX` 的值总是"新鲜"且准确的。
这是实现所有高级导航的基础。

2.  **核心算法：多点探测 (`handleArrowVertical` in `tableKeys.js`)**
    *   这是整个功能的大脑。当用户按下 `ArrowUp` 或 `ArrowDown` 时，此函数被触发。
    *   它首先从状态插件中读取已保存的 `lastGoodX`。
    *   在确定了目标单元格后，它并未采用简单的单点坐标猜测，而是执行了一套更稳健的**"多点垂直探测"**策略：
        *   它会在目标单元格的垂直范围内，选取多个代表性的Y坐标点（如靠近顶部、中部、靠近底部）。
        *   然后，它会带着 `lastGoodX` 逐个在这些Y坐标点上调用 ProseMirror 的 `view.posAtCoords()` 
        API，尝试将屏幕坐标反解为文档中的精确位置。
    *   只要任意一次探测成功返回了**位于目标单元格内容区域内**的有效位置，该位置就会被立即采用，探测随即停
    止。
    *   如果所有探测都失败了（例如，在空的或结构异常的单元格中），它会优雅地回退，将光标安全地置于目标单元格
    内容的开头。

**第二层：解决多行单元格内的“过早跳转”问题**

在实现了基础探测后，我们遇到了第一个问题：在包含多行内容的单元格内，即使光标未到内容边缘，按箭头键也会直接跳转到相邻单元格。

*   **解决方案：单元格内的边缘检测**: 我们在`handleArrowVertical`的入口处增加了“边缘检测”逻辑。该逻辑通过比较光标的实时屏幕Y坐标与单元格内容顶/底部的Y坐标，来判断光标是否已到达内容的物理边缘。只有当光标确实处于边缘时，才允许执行后续的跨单元格“多点探测”；否则，事件将被交还给ProseMirror默认处理，以实现单元格内的平滑移动。

**第三层：攻克混合行高下的“垂直空白陷阱”**

在解决了行内导航后，我们遇到了最棘手的挑战：在混合行高的表格中（例如，A列高、B列矮），B列单元格被CSS拉伸，其下方出现大量“垂直空白”。此时，`posAtCoords`在空白区域会发生“吸附效应”，总是错误地返回内容块的边界位置，导致光标跳到开头或结尾。

*   **解决方案：优雅降级至自定义几何分析**: 我们为“多点探测”设计了终极的回退方案。
    1.  **创建自定义定位器**: 我们编写了`positionInCellAtCoords`函数，这是一个不依赖ProseMirror“黑盒”的自定义定位器。它通过浏览器原生的`range.getClientRects()` API，直接分析目标单元格内渲染出的每一行文本的精确几何矩形。
    2.  **优雅降级**: 在`handleArrowVertical`中，只有当初始的“多点探测”完全失败时（这意味着探测点很可能落在了空白区域），我们才会调用`positionInCellAtCoords`。
    3.  **精准计算**: 这个自定义函数会遍历所有文本行的几何信息，精确地找到与`lastGoodX`和目标Y坐标最匹配的字符，并返回其文档位置。

当前实现细节：

- `positionInCellAtCoords` 会用 `TreeWalker` 深度遍历 `tableCellContentBlock` 里的文本节点，因此能处理 mark / link / citation 等嵌套 inline，而不是只看直接文本子节点。
- 如果目标 Y 坐标落在混合行高导致的垂直空白区，会先找到最近的真实文本行矩形，再把 `(targetX, targetY)` 夹回该行内部，最后才调用浏览器 caret API。
- 浏览器 caret API 返回的位置必须仍在当前 `tableCellContentBlock` DOM 与 ProseMirror 内容边界内，否则返回 `null`，交给 `handleArrowVertical` 的内容开头/末尾终极降级。
- `tableKeys.test.js` 固定了 `ArrowDown` 的三个协议分支；`position/tableNodeAtCoords.test.js` 固定了嵌套 inline 与垂直空白场景。

通过这套**“基础探测 + 边缘检测 + 优雅降级至自定义几何分析”**的三层精细化策略，我们以一种对性能影响极小且高度模块化的方式，成功攻克了这一业界难题，提供了在任何复杂表格布局下都稳定、流畅的导航体验。

### 统一的块间垂直导航（进出表格）

在解决了表格内部的复杂导航之后，我们遇到了另一个极具挑战性的问题：如何实现光标在表格与外部其他文本块之间的流畅、直观的垂直导航。

#### **挑战：原子块边界的导航鸿沟**

ProseMirror 的默认导航机制在处理像表格这样的“原子块”时，存在天然的鸿沟。当用户按上下箭头键试图从一个普通文本块进入表格，或从表格内部跳出时，光标的行为往往不符合预期：
- **目标位置不明确**: 光标通常会直接跳到相邻块的逻辑起点或终点，忽略了用户期望保持的视觉对齐。
- **触发条件不一致**: 导航的触发往往依赖于光标是否精确处于块的逻辑边界（例如，第一个或最后一个字符之后），而不是用户感知的视觉行首或行尾，导致体验割裂。

#### **解决方案：基于视觉边界的全局导航处理器**

为了彻底解决这个问题，我们放弃了在原有表格导航逻辑上进行修补的思路，转而设计并实现了一套全新的、基于明确导航原则的全局块间导航方案。

**导航原则：**
我们确立了简洁而一致的导航原则，以消除不确定性：
-   **向上导航 (↑)**: 总是导航至目标块（无论是普通文本块还是表格）的**内容末尾**。
-   **向下导航 (↓)**: 总是导航至目标块（无论是普通文本块还是表格）的**内容开头**。

**技术实现细节：**

1.  **分层的事件处理架构 (`CoreShortcutExtension.js`)**:
    *   我们创建了一个新的键盘处理器模块 `BlockNavigation.js`，专门负责处理所有跨块的垂直导航逻辑。
    *   在 `CoreShortcutExtension.js` 中，我们将这个新处理器的优先级设置为 `95`。这是一个关键决策，它确保了我们的全局导航逻辑会在特定节点的内部导航（如表格内部，优先级为 `100`）执行之后，但在 ProseMirror 的默认行为（优先级最低）之前被调用。
    *   这种分层机制使得事件处理流程清晰可控：首先尝试在节点内部解决，如果不行（到达边界），再交由我们的全局处理器，最后才是默认行为。

2.  **可靠的视觉边界检测 (`BlockNavigation.js`)**:
    *   我们摒弃了之前依赖坐标计算或偏移量判断的复杂方法，转而采用了 ProseMirror `EditorView` 实例上一个强大且稳定的内置方法：`view.endOfTextblock("up" | "down")`。
    *   这个方法能够精确地判断当前光标是否已经到达了其所在文本块的**视觉上**的顶部或底部，而无需我们关心底层的DOM结构或光标的具体偏移量。这极大地简化了代码并提高了可靠性。

3.  **精确的目标位置计算与设置**:
    *   **移出表格/进入普通块**:
        *   向下导航到普通块开头：通过 `nextNode.pos + 2` 直接计算出内容块内部的起始位置。
        *   向上导航到普通块末尾：通过 `(prevBlock.pos + 1) + prevContentBlock.content.size` 计算出内容块的结束位置，并最终通过 `(contentBlockPos + 1 + contentBlock.content.size)` 的精确计算，将光标无误地放置在最后一个字符**之后**。
    *   **进入表格**:
        *   向下导航到表格开头：光标定位到**第一行第一个单元格**内容的开头 (`tablePos + 4`)。
        *   向上导航到表格末尾：光标定位到**最后一行最后一个单元格**内容的末尾。这里我们利用 `TableMap` 来精确找到目标单元格，并结合上述的末尾位置计算公式来设置光标。

通过这套组合拳，我们成功地以一种低耦合、高内聚且逻辑清晰的方式，实现了在整个编辑器范围内（包括与表格的交互）的流畅、可预测的垂直光标导航。

#### **水平导航：解决“跳跃”与“闪烁”问题**

在垂直导航的基础上，我们进一步解决了光标在表格前后进行水平（`←`/`→`）导航时遇到的问题：
- **问题1 (闪烁)**: 在表格前的块尾按 `→`，光标会先短暂地将整个表格节点选中（表现为一个高亮的“长光标”），然后再跳入第一个单元格，造成视觉闪烁。
- **问题2 (跳跃)**: 在表格后的块首按 `←`，光标会完全跳过表格，直接移动到表格前方块的末尾。

**解决方案：**
我们扩展了 `BlockNavigation.js` 中的逻辑，为左右箭头键也添加了自定义处理器，并遵循了与垂直导航一致的简洁原则：
- **从前方进入 (→)**: 在块尾按 `→`，直接将光标平滑地移动到表格**第一个单元格内容的开头**。
- **从后方进入 (←)**: 在块首按 `←`，直接将光标平滑地移动到表格**最后一个单元格内容的末尾**。

通过在 `CoreShortcutExtension.js` 中为 `ArrowLeft` 和 `ArrowRight` 注册这些处理器，我们有效地拦截并覆盖了ProseMirror的默认行为，从而消除了不必要的节点选区和光标跳跃，实现了完整的、四向无死角的流畅块间导航体验。

### 3. 位置工具函数

表格位置相关的工具函数经过模块化重构，分为多个专注的工具文件：

- **tablePositionUtils.js**: 基础位置解析工具
  - 获取节点在文档中的位置信息
  - 获取父节点信息
  - 获取表格单元格的详细信息

- **tableMapUtils.js**: TableMap 相关操作
  - 获取和使用 TableMap 进行行列计算
  - 通过 TableMap 获取单元格信息

- **tableSelectionUtils.js**: 选区相关工具
  - 判断选区是否在表格单元格内
  - 获取选区的解析信息
  - 查找选区所在的单元格和表格信息

- **tableContentUtils.js**: 表格内容工具
  - 获取单元格内容位置
  - 处理新行的插入位置和定位

- **tableNavigationUtils.js**: 导航功能工具
  - 处理箭头键导航
  - 获取下一个单元格位置

- **tableCoordinateUtils.js**: 坐标系统工具
  - 实现 Excel 风格坐标系统 (A1, B2)
  - 提供坐标与内部索引的转换

### 4. 表格坐标系统

通过 `tableCoordinateUtils.js` 实现类Excel的坐标系统：
- 支持 A1, B2 风格的单元格定位
- 区域表示如 A1:C3
- 支持坐标与内部行列索引互转
- 支持获取表头行作为列名引用

### 6. 表格行列坐标系统 (Headers)

我们实现了一套功能强大且高度响应的表格行列坐标系统（即行、列表头），它能够像桌面电子表格软件一样，实时显示当前单元格的坐标，并在用户滚动、编辑或调整表格尺寸时保持精确同步。

```mermaid
graph TD
    subgraph "用户操作"
        A[输入文字<br>增删行列] --> B{ProseMirror<br>事务 (Transaction)};
        C[拖拽调整列宽] --> D{DOM<br>MutationObserver};
        E[滚动页面/编辑器] --> F{DOM<br>Scroll / Resize Events};
    end

    subgraph "TableCoordinateHeaders.vue (核心组件)"
        G["事件监听器<br>(handleTransaction, etc.)"]
        H["DOM 观察器<br>(setupDomObserver)"]
        I["测量与更新逻辑<br>(requestMeasurement)"]
        J["会话隔离<br>(sessionId)"]
        K["rAF 性能优化"]
        L["列宽计算<br>(文档优先, DOM回退)"]
        M["行高计算<br>(DOM测量)"]
        N[最终渲染<br>行列标头UI]

        B --> G;
        D --> H;
        F --> G;
        G -- "触发重算" --> I;
        H -- "触发重算" --> I;
        I -- "使用 sessionId" --> J;
        J -- "有效会话" --> K;
        K -- "下一帧执行" --> L;
        K -- "下一帧执行" --> M;
        L & M --> N;
    end

    subgraph "数据源"
        O["ProseMirror 文档<br>(state.doc, TableMap, colwidth)"];
        P["实时 DOM<br>(getBoundingClientRect)"];
        
        L -- "读取 colwidth" --> O;
        L -- "回退到" --> P;
        M -- "读取高度" --> P;
    end
```

#### **核心挑战**

实现这一功能需要克服三大核心挑战：
1.  **实时响应**: 必须即时响应所有可能影响表格尺寸的操作，包括但不限于：输入文字导致换行、直接增删行列、拖拽调整列宽、合并/拆分单元格。
2.  **状态同步**: 在复杂操作（尤其是异步的AI操作、撤销/重做）后，必须保证行列头的状态（数量、尺寸）与表格的真实状态完全一致，避免出现“幽灵列”或“坐标错乱”等问题。
3.  **性能优化**: 在滚动、拖拽等高频事件中，必须避免性能瓶颈，确保UI的流畅和响应性。

#### **最终技术方案**

我们通过一套分层、解耦的健壮架构，成功应对了上述挑战：

1.  **事务驱动 (Transaction-Driven) 作为最终一致性的保障**:
    *   我们确立了“**ProseMirror 文档为唯一真理之源**”的核心原则。
    *   通过监听 ProseMirror 的 `transaction` 事件，我们能可靠地捕捉到所有对文档的**最终**修改（`docChanged`）。当检测到变化时，我们会触发一次完整的重新测量，确保行列数量与文档模型严格同步。这是解决撤销/重做后状态不一致问题的基石。

2.  **DOM 观察器 (DOM Observers) 实现实时交互**:
    *   为了解决底层库在拖拽列宽时**不派发实时事件**的限制，我们引入了 `MutationObserver`。
    *   它直接监视表格 DOM 元素的 `style` 属性变化，从而在用户拖拽的每一帧都能捕捉到视觉变化，并立即触发列宽的重新计算，实现了“丝滑”的实时跟随效果。

3.  **文档优先，DOM 回退 (Document-First, DOM Fallback) 的混合计算策略**:
    *   **列宽计算**: 我们设计了一套巧妙的混合策略。在常规情况下（如事务触发），优先从 ProseMirror 文档的 `colwidth` 属性中读取宽度，确保数据的准确和稳定。但在 `MutationObserver` 触发的实时拖拽场景中，则**强制回退**到直接测量 DOM，以获取最即时的视觉反馈。
    *   **行高计算**: 由于行高完全由内容决定，我们始终通过测量 DOM (`getBoundingClientRect`) 来获取其高度。

4.  **会话隔离 (Session Isolation) 根除竞态条件**:
    *   为了彻底解决因异步回调（如 `setTimeout`, `requestAnimationFrame`）可能导致的“过时更新”污染当前状态的问题，我们引入了 `sessionId` 机制。
    *   每次组件变为可见时，都会生成一个新的会话 ID。所有异步的测量请求都必须携带当时的会话 ID。当回调准备执行时，会再次检查其 ID 是否与当前组件的会话 ID 匹配。如果不匹配，该回调将被**静默丢弃**，从而完美地避免了竞态条件。

5.  **性能优化 (`requestAnimationFrame`)**:
    *   所有非紧急的测量请求都被包裹在 `requestAnimationFrame` (rAF) 中。这利用了浏览器的刷新循环，将多次连续的重算请求自动合并为一次，有效避免了在高频事件（如滚动）中因过度计算而导致的性能下降和页面卡顿。

通过这套组合拳，我们最终实现了一个既能提供极致实时交互体验，又能在复杂异步场景下保证数据绝对一致和高性能的表格行列坐标系统。

### 5. AI 功能 (AI Features) - 解耦架构

目前，我们已成功实现了 **AI 批量填充 (AI Batch Fill)** 功能，该功能旨在通过AI辅助，高效处理表格中的重复性数据填充任务。**AI 分析选区 (AI Analyze Selection)** 功能则计划在未来的版本中推出。

**AI 批量填充功能详解（当前架构）：**

- `domains/editor/features/table-ai-mode/` 是模式、表身份、列引用与执行态的单一真源。
- `useTableAiInteraction.ts` 负责从当前表格选区构造启动上下文；模式启动后，Editor UI 只读同域 selector。
- 列引用解析和颜色属于 table-ai-mode functions。颜色按当前上下文的列顺序纯计算，同一列在会话内稳定，不存在跨表格共享的颜色映射。
- active refs 写入 feature store 后，同 feature orchestration 直接调用高亮 runtime；延迟调用仍携带 `sessionId`，不能命中新会话。
- 高亮运行时用会话中的稳定表身份从最新文档重新定位表格，再把每列颜色分别写入 Decoration CSS 变量。
- 退出由 `deactivateTableAiMode` 单一编排负责：先进入 `closing`，直接清理当前表格装饰，再按需撤销新增列，最后按原 `sessionId` 结算为 `off`。

现行实现入口：

- `domains/editor/features/table-ai-mode/orchestration/tableAiColumnReferenceRuntime.ts`
- `domains/editor/features/table-ai-mode/orchestration/tableAiHighlightRuntime.ts`
- `domains/editor/features/table-ai-mode/orchestration/tableAiModeLifecycle.ts`
- `domains/editor/blocks/TableBlock/integrations/setup.js`（`setupTableAiHighlightRuntime` 只负责注册 editor 实例，不保存模式状态）

**未来展望:**

AI分析选区功能，旨在对用户选定的整个表格区域进行聚合分析、总结或提取信息，并将结果输出到指定位置。此功能已在PRD中规划，并将在后续版本中进行开发。

## TableBlock 开发核心标准与最佳实践

在 TableBlock 的开发和维护过程中，由于其涉及到 ProseMirror 深度嵌套的节点结构和精确的位置解析，遵循以下核心标准与最佳实践至关重要。这将有助于确保功能的稳定性、可维护性，并减少潜在错误。

### 1. 理解 ProseMirror 位置系统的核心：节点 vs. 内容

这是最基本也最容易混淆的概念，务必精确区分：

*   **节点自身位置 (`$pos.before(depth)`)**:
    *   返回在指定深度 `depth` 的祖先节点 **本身（其开标签）** 的起始位置。
    *   **标准**: 在获取 `tableCell`、`tableHeader` 或 `tableRow` 等容器节点的准确起始位置时，**应优先使用此方法**。例如，在 `TableCellInteractionExtension.js` 中，`activeCellPos` 存储的就是通过此方法获取的单元格节点起始位置。

*   **节点内容位置 (`$pos.start(depth)`)**:
    *   返回在指定深度 `depth` 的祖先节点 **内容** 的起始位置（即其开标签之后的位置）。
    *   **注意**: `CellSelection` 中的 `selection.$anchorCell.pos` (或 `$headCell.pos`) 指向的是 `tableCellContentBlock` 节点的起始位置（即 `tableCell` 节点位置 + 1）。在使用时务必与单元格节点自身的起始位置区分。

**混淆这两者是导致复杂导航、选区判断和节点操作逻辑出错的主要原因。**

### 2. 与 `TableMap` 的正确交互

`TableMap` 是处理表格结构化信息的强大工具，但需正确使用其 API：

*   **`TableMap.get(tableNode)` 是快照**:
    *   获取到的 `map` 实例是基于调用时 `tableNode` 状态的一个快照。如果在后续的事务中修改了 `tableNode`，原 `map` 不会自动更新。在需要基于最新状态的 `map` 时，应重新获取。

*   **`map.findCell(pos)` 的 `pos` 参数**:
    *   **标准**: `pos` 参数应为目标单元格节点在文档中的起始位置 (`cellNodeDocPos`) 相对于表格**内容区**起始位置 (`tableStartPos + 1`) 的偏移量。
    *   精确计算: `offsetForFindCell = cellNodeDocPos - (tableStartPos + 1)`。
    *   任何偏差（例如，错误地使用 `cellNodeDocPos - tableStartPos`）都可能导致 `RangeError: No cell with offset X found`。

*   **`map.rectBetween(anchorCellOffset, headCellOffset)` 的参数**:
    *   这里的偏移量通常是这样计算的：`anchorCellOffset = selection.$anchorCell.pos - tableStartPos`。
    *   `selection.$anchorCell.pos` 指向 `tableCellContentBlock` 的起始位置（即 `cellNodeStartPos + 1`）。因此，传递给 `rectBetween` 的参数实际上是 `(cellNodeStartPos + 1) - tableStartPos`。
    *   `rectBetween` 能够正确处理这种基于 `CellSelection` 计算出的偏移，表明其内部有相应的转换逻辑来适应基于 `tableCellContentBlock` 的定位。

*   **读取 / 写入已有逻辑坐标时使用 `getCellOffsetAtLogicalPosition`**:
    *   `map.positionAt(row, col, tableNode)` 更偏向“推导插入位置”，不能作为合并单元格场景下的已有 cell 覆盖查询。
    *   `map.map[row * map.width + col]` 才表示某个逻辑格子当前被哪个物理 cell 覆盖。项目内统一通过 `position/tableMapUtils.js` 的 `getCellOffsetAtLogicalPosition` 访问这层语义。
    *   Table AI 写表、逐行上下文、批量填充、AI 高亮装饰、Excel 坐标定位和坐标轴测量都必须先解析逻辑坐标覆盖的物理 cell；不要把 `rowNode.child(colIndex)` 当作目标 cell。

*   **键盘导航已有单元格时使用 `tableNavigationUtils`**:
    *   `Shift+Tab`、从外部进入表格开头/末尾、以及“最后一行第一列”等导航，都要先解析用户看到的逻辑格子，再落到真实覆盖 cell 的 `tableCellContentBlock` 内部。
    *   垂直移动（Enter / ArrowUp / ArrowDown）不要用 `row + 1` 加 `positionAt` 猜目标。当前 cell 存在 `rowspan` 时，应通过 `TableMap.nextCell` 找到跨度之外的真实垂直邻居。
    *   这些规则已收口到 `position/tableNavigationUtils.js`：`getCellNavigationTargetAtLogicalPosition` 处理逻辑格子覆盖，`getAdjacentVerticalCellNavigationTarget` 处理垂直邻居。

### 3. 事务（Transaction）内多步骤修改的黄金法则：`tr.mapping`

当在一个事务中执行多个修改文档的操作时（例如，在循环中为多行插入单元格）：

*   **标准**: 在上一个修改操作（如 `tr.insert()`）完成后，如果需要进行后续的修改操作，并且该操作依赖于文档中的某个位置，**必须**使用 `tr.mapping.map(originalPosition)` 来获取该位置在当前事务状态下的正确映射。
    ```javascript
    // 示例：在循环中插入节点
    for (let i = 0; i < N; i++) {
      // 1. 基于原始文档或上一步结束时的状态计算 originalInsertPos
      const originalInsertPos = calculateOriginalPos(...);
      
      // 2. 获取当前事务状态下的正确插入位置
      const mappedInsertPos = tr.mapping.map(originalInsertPos); 
      
      // 3. 使用映射后的位置执行插入
      tr.insert(mappedInsertPos, newNode);
      
      // 4. 如果需要，更新光标位置，同样需要考虑映射
      const mappedCursorPos = tr.mapping.map(originalCursorPosAfterInsert);
      tr.setSelection(TextSelection.create(tr.doc, mappedCursorPos));
    }
    ```
*   **原因**: `tr.mapping` 记录了事务中每一步修改对文档位置的改变。忽略它会导致后续操作在已经失效的旧位置上进行，引发各种错误，如内容插入错位、`baseBlock` 异常、节点结构损坏等。

### 4. 自定义命令 (`addCommands`) 的标准结构

为 Tiptap 编辑器添加自定义命令时（例如在 `TableBlock.js` 的 `addCommands` 中）：

*   **标准**: 必须区分命令的"检查能力 (`.can()` 调用)"阶段和"实际执行"阶段。这通过检查传递给命令函数的 `props` 对象中是否存在 `dispatch` 方法来实现。
    ```javascript
    export const myCustomCommand = () => (props) => {
      const { tr, state, dispatch } = props;
      const isCanCheck = !dispatch; // 如果 dispatch 不存在，则为 .can() 调用

      if (isCanCheck) {
        // .can() 检查逻辑:
        // - 只能进行只读操作。
        // - 不能修改 tr 或 state。
        // - 返回 true 或 false。
        // 例如: return checkSomething(state, ...);
      }

      // 实际执行逻辑 (dispatch 存在):
      // - 在这里修改 tr。
      // - 例如: tr.insert(...);
      // - dispatch(tr); // 注意：在Tiptap的命令链中，通常只需修改tr并返回true/false，由链式调用末尾的 .run() 统一dispatch。
      //   但如果是在 addCommands 中直接返回 props => boolean 的形式，则需要自己 dispatch。
      //   在我们的 TableBlock.js 模式中，工厂函数返回 props => boolean，此函数修改 tr 并返回 true，由外部的 editor.chain()...run() 处理 dispatch。
      return true; // 表示命令成功应用
    };
    ```
*   **原因**: Tiptap 的 `editor.can().yourCommand()` 会实际执行 `yourCommand` 并传入 `props` (但不含 `dispatch`)。如果此时执行了修改操作，会导致意外的副作用和状态不一致。

### 5. 应用 Decorations (如单元格高亮、操作柄)

精确控制 Decoration 的位置对于 UI 至关重要：

*   **`Decoration.widget`**:
    *   `pos` 参数: 通常应设置为目标单元格**内容块**（即 `tableCellContentBlock`）的起始位置。如果 `activeCellPos` 是单元格节点 (`<td>`/`<th>`) 的起始位置 `P_cell_A`，则 widget 的 `pos` 应为 `activeCellPos + 1`。
    *   `side` 参数: 通常设为 `0` 或 `1`，以控制其相对于 `pos` 的精确渲染。
    *   CSS 定位: 单元格节点 (`<td>`/`<th>`) 应设置 `position: relative;`
    *   单元格左上角选中柄当前不是 Decoration widget，而是 editor 级 Vue overlay；其定位遵循上文“单元格选中柄定位”约定。

## 状态管理：ProseMirror 与 Vue 的协同工作模式

在 TableBlock 中，我们面临一个典型的挑战：如何让非响应式的 ProseMirror "内核" 与响应式的 Vue "视图" 高效、可靠地协同工作。我们建立了两种核心模式来处理不同的场景，确保职责清晰、性能最优。

### 模式 A: ProseMirror 状态 → Vue 组件渲染 (以外部 UI 为例)

此模式用于当 ProseMirror 的状态需要驱动一个独立的、浮动的 Vue 组件的渲染时，例如我们实现的单元格操作柄 (`TableCellHandleOverlay`)。

```mermaid
graph TD
    subgraph ProseMirror
        A["用户操作 (如: 单击)<br>或事务更新"] --> B{Plugin State<br>apply()};
    end

    subgraph Vue
        B --> C[transaction 监听<br>读取 Plugin State];
        C --> D[Vue 组件<br>TableInteractionManager];
        D --> E[子组件接收 Props<br>TableCellHandleOverlay];
        E --> F[Teleport 到 body<br>显示/移动操作柄];
    end
```

**数据流:**
1.  **状态源头 (ProseMirror)**: 用户的交互（如单击单元格）被 ProseMirror 插件捕获，并通过 `tr.setMeta()` 更新插件的内部状态（例如，`activeCellPos`, `showHandle: true`）。
2.  **状态桥梁 (The Bridge)**: `TableInteractionManager` 监听 editor transaction，并通过 `TableCellInteractionPluginKey.getState(editor.state)` 读取当前插件状态；不再维护第二份全局响应式状态。
3.  **状态投影 (Vue)**: manager 将 `activeCellPos` 和 `showHandle` 投影为当前 editor 实例内的响应式状态，并通过 props 传给 `TableCellHandleOverlay`。
4.  **最终渲染 (Vue)**: overlay Teleport 到 `body`，通过 `useTableCellHandlePosition` 把单元格视口矩形映射为 handle 位置，并在真实布局变化时重新测量。

**结论**: ProseMirror plugin state 是交互状态的唯一数据源；Vue 层只做当前 editor 的状态投影、定位和渲染，避免通过全局 manager 复制状态。

### 模式 B: ProseMirror 状态 → DOM 装饰 (以内联样式为例)

此模式用于直接修改编辑器内容 DOM 的样式，例如高亮选中的单元格。这是 ProseMirror 的原生工作方式，性能极高。当我们需要实现比原生行为更复杂的视觉效果（例如为多选区添加**单一边框**）时，此模式尤为强大。

```mermaid
graph TD
    subgraph ProseMirror
        A["用户三击或拖拽<br>创建 CellSelection"] --> B{EditorState 更新};
        B --> C{view.updateState()<br>自动调用};
        C --> D{插件 props.decorations()<br>被调用};
        D --> E[**返回自定义 DecorationSet**<br>1. 计算边缘单元格<br>2. 动态生成 box-shadow 样式];
        E --> F[ProseMirror<br>直接更新 DOM<br>应用内联样式];
    end

    subgraph DOM
        G[原生机制<br>为所有选中单元格<br>添加 .selectedCell 类]
        F --> H[单元格边框<br>呈现为 box-shadow];
        B --> G;
        G --> I[单元格背景色<br>由 CSS 定义];
    end

    style E fill:#cce5ff,stroke:#333,stroke-width:2px
```

**数据流 (协作模式):**
1.  **状态源头 (ProseMirror)**: 用户的交互（三击或拖拽）创建了一个原生的 `CellSelection`，直接更新了 `editorState.selection`。
2.  **双轨并行处理**: `CellSelection` 的出现触发了两种并行的处理机制：
    *   **轨道A (原生机制)**: ProseMirror 表格插件的原生能力被触发，自动为所有被选中的单元格添加 `.selectedCell` CSS 类。我们利用这一点，在 `table.css` 中为该类定义了统一的 `background-color`，高效地处理了背景高亮。
    *   **轨道B (自定义扩展)**: 同时，ProseMirror 内核调用我们 `TableSelectionDecoratorExtension` 插件的 `decorations` 方法。
3.  **计算装饰 (我们的插件)**: 在 `decorations` 方法中，我们执行了更精细的逻辑：
    *   获取选区的矩形范围 (`selectedRect`)。
    *   遍历选区，**只识别处于矩形边缘的单元格**。
    *   为每个边缘单元格动态计算并生成一个 `box-shadow` 样式字符串。这个样式的巧妙之处在于它只绘制单元格朝外的那条边（例如，上边缘的单元格是 `inset 0 2px 0 0 #color`），而角上的单元格会合并两条边的阴影。
4.  **返回装饰集 (我们的插件)**: 该方法返回一个 `DecorationSet`，其中包含为每个边缘单元格应用 `style` 属性（包含 `box-shadow`）的 `Decoration.node`。
5.  **DOM 更新 (ProseMirror)**: ProseMirror 内核接收到我们返回的 `DecorationSet`，并将这些内联样式精确地应用到对应的 `<td>` 元素上。

**结论**: 这种"**原生为主，扩展为辅**"的协作模式是 ProseMirror 开发的最佳实践。我们充分利用了原生机制的高效率来处理简单的背景填充，同时通过自定义 `Decoration` 以一种极其巧妙且对布局无影响的方式，解决了原生机制无法实现的、复杂的"单一边框"视觉效果，并确保了与单选编辑状态的视觉统一。

### 总结

通过这两种模式的组合，我们为不同的场景选择了最合适的工具：
-   对于编辑器外部的、复杂的、独立的 UI，使用 **模式 A**，让 Vue 发挥其长处。
-   对于编辑器内部的、与内容紧密耦合的样式和标记，使用 **模式 B**，让 ProseMirror 发挥其长处。

这种清晰的职责划分是构建稳定、高性能 Tiptap 应用的关键。

### 核心架构：`TableCellInteractionExtension` 作为状态桥梁

在我们建立的两种模式中，`TableCellInteractionExtension.js` 插件扮演着不可或缺的**核心桥梁**角色。它不是一个简单的功能插件，而是整个表格交互功能的"中央处理器"，负责在 ProseMirror 的非响应式世界和 Vue 的响应式世界之间进行双向的"信号转译"和"指令传达"。

事件入口标准：

- 浏览器事件的 `event.target` 不保证是 Element，可能是 Text 节点或 Document。
- `TableCellInteractionExtension` 内部统一通过 `findClosestElementFromTableEventTarget` 做 target 归一化，再执行 `closest(...)` 查询。
- 这条规则覆盖单元格点击回退解析、mousemove handle 判断、document mousedown 外部点击收起，避免某个分支在文本节点上直接调用 `target.closest(...)`。

```mermaid
graph TD
    subgraph "Vue 世界 (响应式)"
        A["Vue 组件<br>(TableCellHandleOverlay)"]
        B["TableInteractionManager<br>transaction 监听"]
        A -- "2a. 用户点击操作柄" --> C{dispatch(tr.setSelection(...))};
        B -- "1b. 渲染/更新 Vue 组件" --> A;
    end

    subgraph "ProseMirror 世界 (非响应式)"
        D["PM 插件<br>(TableCellInteractionExtension)"]
        E["PM 状态<br>(EditorState)"]
        F["PM DOM<br>(Decorations)"]
        G["用户在编辑器内<br>单击或三击"]

        G -- "1a. 触发 props.handleClick" --> D;
        C -- "2b. 发送指令到内核" --> E;
        E -- "自动触发" --> D;
        D -- "计算状态/装饰" --> E;
        D -- "更新高亮" --> F;
        E -- "transaction 后<br>读取 Plugin State" --> B;
    end

    style D fill:#f9f,stroke:#333,stroke-width:2px
```

**这个桥梁的工作是双向的：**

#### 数据流 A：ProseMirror 内核 → Vue 视图 (将内核状态"翻译"为 Vue 信号)

这是 **模式 A** 的核心实现。当用户在编辑器内部进行操作时（如单击、输入、改变选区），流程如下：

1.  **事件捕获**: `TableCellInteractionExtension` 通过其 `props` (如 `handleClick`) 或 `appendTransaction` 钩子捕获到 ProseMirror 内部的原始事件或事务。
2.  **状态计算**: 插件对这些原始信息进行处理，计算出应用层需要关心的状态，例如 `activeCellPos`, `showHandle`, `interactionMode`。
3.  **事务通知**: editor 发出 transaction 事件后，`TableInteractionManager` 从当前 `EditorState` 读取该插件状态。这里不复制 ProseMirror 状态到全局 store，也不跨 editor 共享 handle 状态。
4.  **Vue 响应**: manager 更新当前组件实例中的 `activeCellPos/showHandle`，驱动 `TableCellHandleOverlay` 重新定位和渲染。

#### 数据流 B：Vue 视图 → ProseMirror 内核 (将 Vue 事件"翻译"为 ProseMirror 指令)

这是上述双向桥梁的反向数据流。当用户与 Vue 组件交互时（如点击选中柄），流程如下：

1.  **事件捕斥**: 在 `TableCellHandleOverlay` 的 `@mousedown` 事件中，我们不再发送自定义的元数据，而是直接构造一个 ProseMirror 的原生指令。
2.  **指令构造**: 我们创建一个 `new CellSelection()`，这是 ProseMirror 表格插件能理解的、用于"选中单元格"的官方语言。
3.  **指令分发**: 我们将这个 `CellSelection` 包装在一个事务中，通过 `view.dispatch(tr)` 发送出去。**此刻，指令正式跨越了 Vue 与 ProseMirror 之间的桥梁。**
4.  **ProseMirror 响应**: ProseMirror 内核接收到这个包含 `CellSelection` 的事务后，会执行其**默认逻辑**：
    *   自动更新 `editorState.selection`。
    *   自动为其 `decorations` 属性函数提供新的状态。
    *   自动为被选中的单元格节点应用 `.ProseMirror-selectednode` CSS 类，从而完成高亮。

通过让 `TableCellInteractionExtension` 承担这个双向桥梁的职责，我们实现了完美的关注点分离：Vue 专注于表现，ProseMirror 专注于状态和内容，两者之间通过这个明确的、唯一的通道进行通信，使得整个系统既健壮又易于理解。
