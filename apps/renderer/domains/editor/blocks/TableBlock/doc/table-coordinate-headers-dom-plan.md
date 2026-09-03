### Table Headers 使用 Floating UI 重构方案

- 目标：用 Floating UI 重写表格坐标头（列标/行标）的定位与跟随逻辑，保持原有交互，解决错位、滞后、滚动条遮挡等问题。
- 范围：仅重构 Table Headers（`TableColumnHeaders.vue` / `TableRowHeaders.vue` 与 `TableCoordinateHeaders.vue` 相关定位逻辑）；不改变视觉样式与业务行为。

## 1. 目标与约束

- 必须行为
  - 顶部列标：横向跟随表格滚动；纵向相对屏幕固定（即随表格上下移动，但在表格上沿）。
  - 左侧行标：纵向跟随表格滚动；横向相对屏幕固定（即随表格左右移动，但在表格左沿）。
  - 滚动条遮挡：当滚动条出现时，headers 应该被滚动条遮挡（不盖在滚动条之上）。
  - 列宽/行高变化后对齐无抖动；侧边栏展开/收缩、窗口缩放、放大缩小、编辑器事务变化，headers 均能稳态跟随。

- 非功能性要求
  - 丝滑：滚动/拖拽/调整列宽无明显滞后。
  - 稳定：避免旧逻辑抖动/错位问题，支持回滚开关。
  - 最小侵入：尽量少改 DOM 结构；优先挂载在现有容器中。

## 2. Floating UI 方案要点（官方最佳实践对照）

- 组合式 API：`useFloating`（Vue 绑定）+ `autoUpdate`（建议动画帧更新）。
- 定位策略：headers 挂载在滚动容器内部，使用 `strategy: 'absolute'`，确保能被滚动条遮挡。（参考 docs: strategy 与 clipping）
- 虚拟锚点（Virtual Elements）：用 `getBoundingClientRect()` 定义一个与表格相对的虚拟矩形，作为 headers 的 reference；使用 `contextElement` 指向真实 `table` DOM，保证溢出检测/更新触发正确。（参考 docs: Virtual Elements）
- 中间件（Middleware）：
  - `offset(0)`：距离控制
  - `size()`：按需将 headers 尺寸与锚点对齐（列标：width 对齐；行标：height 对齐）
  - `shift()`：必要时避免溢出（保守开启，padding 小）
- 自动更新：`whileElementsMounted: (...args) => autoUpdate(...args, { animationFrame: true })`，确保滚动/resize/变换/布局变化期间稳定更新。（参考 docs: autoUpdate）


### 2.1 为什么用 Floating UI
统一解决定位问题：元素锚定、碰撞/溢出、容器裁剪、滚动/缩放/变换触发的重算。
Vue 官方绑定可组合：useFloating + autoUpdate + middleware，支持虚拟锚点、portal、更新节流。
与你提到的核心矛盾契合：信息源与渲染目标分离、实时依赖多源、性能约束、CSS 层叠/裁剪限制。
关键能力与最佳实践（来源：官方文档）
Vue 绑定与自动更新: useFloating + whileElementsMounted: autoUpdate({ animationFrame: true }). 参考: Floating UI Vue docs, autoUpdate。
定位策略: strategy: 'absolute' 与 'fixed'（absolute 贴最近定位祖先，fixed 贴视口，能“逃离”裁剪，但不保证100%）。参考: useFloating strategy, Misc > Clipping。
中间件: offset（距离/边距）、shift/flip（避免溢出）、size（动态调整尺寸/对齐宽度）、inline/virtual（复杂锚点）。参考: Middleware, Virtual Elements。
z-index/裁剪: 库不管 z-index，裁剪祖先 overflow: hidden 需 portal 或 fixed strategy。参考: Misc > z-index/clipping。
性能: 默认 transform 定位最平滑；必要时 transform: false + top/left。DPR 对齐避免文本模糊。参考: Misc > Subpixel/transform。

## 3. 架构设计

- 宿主层（容器）
  - 使用现有 `.scroll-content-wrapper`（`AppLayout.vue`）作为 headers 的定位上下文；要求该容器 `position: relative`（已满足）。
  - headers DOM：作为 `.scroll-content-wrapper` 的子元素（无需 portal 到 body），从而自然受滚动条与裁剪影响，可被滚动条遮挡。

- 锚点（reference）
  - 取 `tableEl.getBoundingClientRect()`（视口坐标），基于此构造两种虚拟锚点矩形：
    - 顶部列标（column header）
      - rect: `{ left: table.left, top: table.top - HEADER_HEIGHT, right: table.right, bottom: table.top, width: table.width, height: HEADER_HEIGHT }`
      - placement: `'top-start'`
      - middleware: `[offset(0), size({ apply: matchWidthToReference })]`
    - 左侧行标（row header）
      - rect: `{ left: table.left - ROW_HEADER_WIDTH, top: table.top, right: table.left, bottom: table.bottom, width: ROW_HEADER_WIDTH, height: table.height }`
      - placement: `'left-start'`
      - middleware: `[offset(0), size({ apply: matchHeightToReference })]`
  - `contextElement = tableEl`：确保溢出检测/自动更新能感知表格上下文。

- 定位策略与层级
  - `strategy: 'absolute'`（headers 相对于 `.scroll-content-wrapper` 绝对定位）
  - z-index：列标 `0`，行标 `1`（略高于列标），低于侧边栏/AI 面板；保证滚动条可遮挡。

## 4. 落地步骤

步骤 0：建立开关
- 新增 feature flag：`useFloatingHeaders`（默认 false）；允许快速回退旧方案。

步骤 1：提取基建（共享）
- 新增 `shared/utils/floating/virtualAnchors.ts`
  - `createVirtualRectAnchor(getRect: () => DOMRectLike, contextElement: Element)`
- 新增 `shared/utils/floating/useAnchoredFloating.ts`
  - 包装 `useFloating`，默认：`whileElementsMounted: autoUpdate(animationFrame: true)`，`transform: true`，`strategy` 由调用方传。
  - 预置中间件注入与 reactive 依赖。

步骤 2：在 `TableCoordinateHeaders.vue` 侧实现
- 保留现有列宽/行高测量逻辑（不动 UI 内容）。
- 找到表格 DOM：`editor.view.nodeDOM(tablePos)`。
- 找到滚动容器：`.scroll-content-wrapper`（或 `.editor-shell`，但 headers 必须是 `.scroll-content-wrapper` 的子元素）。
- 若当前 DOM 树中 headers 不是挂载到 `.scroll-content-wrapper`，使用 `Teleport to=".scroll-content-wrapper"`（优先复用，不新增层）。
- 将 `tableEl` 作为 `contextElement` 传递给子组件。

当前进展：
- `tableCoordinateHeaderMetrics.ts` 已承接纯测量逻辑：table DOM 解析、横向滚动容器解析、列宽/行高/位置计算。
- `useTableCoordinateHeaderController.ts` 已承接坐标轴会话与监听生命周期：visible/tableInfo/editor watch、横向/纵向滚动监听、window resize、PM transaction、虚拟化 transaction 后的 DOM 重绑、列宽拖拽 MutationObserver。
- `tableCoordinateHeaderStyles.ts` 已承接 Column/Row header 的定位样式计算。子组件只消费 controller 输出的测量状态，不再自己持有 `scrollContainer` 的 autoUpdate，避免虚拟化 hydrate 后子组件盯住旧 DOM。
- `useTableCoordinateHeaderLayoutSync.ts` 已承接侧栏布局同步：左侧栏 / AI 侧栏显隐期间逐帧测量，宽度变化合批到下一帧，快速连续动画会取消旧 rAF 会话。
- `TableCoordinateHeaders.vue` 当前只保留 props 接线和子组件渲染。后续若继续接入 Floating UI，应优先复用 controller 暴露的 `tableElement` / `tableScrollContainer` / 测量状态，不再把 listener 生命周期写回 Vue 组件。

步骤 3：重写 `TableColumnHeaders.vue`
- 使用 `useAnchoredFloating`：
  - reference：`createVirtualRectAnchor(() => rectForTopHeader(tableEl), contextElement: tableEl)`
  - options：`placement: 'top-start'`, `strategy: 'absolute'`
  - middleware：
    - `offset(0)`
    - `size({ apply: ({ rects, elements }) => elements.floating.style.width = rects.reference.width + 'px' })`
- 应用 `floatingStyles` 到外层节点，保留内部 `v-for` 结构与样式。
- z-index: `0`，pointer-events: none。

步骤 4：重写 `TableRowHeaders.vue`
- 类似 `TableColumnHeaders`，但：
  - reference：`rectForLeftHeader(tableEl)`
  - placement: `'left-start'`
  - middleware：
    - `size({ apply: ({ rects, elements }) => elements.floating.style.height = rects.reference.height + 'px' })`
- z-index: `1`。

步骤 5：自动更新与事件接入
- `useAnchoredFloating` 已开启 `autoUpdate(animationFrame: true)`，覆盖滚动/resize/布局突变。
- 再补充手动 update 的触发（rAF 合批）：
  - 侧边栏宽度变化与侧边栏显隐动画已由 `useTableCoordinateHeaderLayoutSync.ts` 统一触发
  - 编辑器 transaction（尤其列宽元数据更新）
  - 列宽拖拽：MutationObserver 监听 `tableEl` 下 `colgroup > col[style]` 变更 → rAF update()

步骤 6：样式与可被滚动条遮挡校验
- 确认 headers 确实是 `.scroll-content-wrapper` 的子元素（而不是 portal 到 body）。
- z-index 保持低于滚动条抽屉；不要给 headers 过高层级；验证横/竖滚动条遮挡。

步骤 7：灰度 & 回滚
- feature flag 控制启用；默认对小流量/开发环境开启。
- 出现问题时可即时回退；保留旧逻辑一段时间。

## 5. 代码骨架（伪接口与关键点）

- `virtualAnchors.ts`
  - `export function createVirtualRectAnchor(getRect, contextElement) { return { getBoundingClientRect: getRect, contextElement }; }`

- `useAnchoredFloating.ts`
  - 接口：`useAnchoredFloating(reference: Ref<RefElOrVirtual>, floatingRef: Ref<HTMLElement | null>, options)`
  - 内部：`useFloating(reference, floatingRef, { whileElementsMounted: (...args)=>autoUpdate(...args,{animationFrame:true}), transform:true, ...options })`
  - 返回：`floatingStyles`, `update`, `isPositioned`

- `TableColumnHeaders.vue`
  - props：`{ tableElement: HTMLElement, columnWidths: number[] }`
  - `reference = createVirtualRectAnchor(() => rectForTopHeader(tableElement), tableElement)`
  - `useAnchoredFloating(reference, floatingRef, { placement:'top-start', strategy:'absolute', middleware:[offset(0), size(...)] })`

- `TableRowHeaders.vue`
  - 同上，rect 计算与 middleware 差异见上文。

- `TableCoordinateHeaders.vue`
  - 传入 `tableElement` 给子组件；headers Teleport 到 `.scroll-content-wrapper`（仅当当前挂载不在该容器时）。

## 6. 性能与稳定性

- 使用 `transform`（默认）定位；需要时可 `transform:false` + `top/left`，并确保固定宽度/`max-content`。
- DPR 对齐：如遇文本模糊，可按官方建议对 x/y 做 `roundByDPR`（视情况准备备用）。
- rAF 合批：对高频更新（列宽拖拽、滚动）避免多次 `update`；遵从 autoUpdate 的 animationFrame。

## 7. z-index / 层级策略

- `.scroll-content-wrapper` 内 headers：`z-index: 0/1`（列/行）。
- `.annotation-layer`：`z-index: 10`
- 侧边栏/AI 面板：`z-index: 200`
- 交互柄 overlay：≥ `1000`
- 不要为 headers 提升过高 z-index（会盖住滚动条）。

## 8. 测试与验收

- 功能测试
  - 横向/纵向滚动：headers 跟随无抖动；滚动条可遮挡
  - 侧边栏展开/收缩、拖拽宽度：headers 稳定、无闪动
  - 列宽拖拽：headers 实时对齐
  - 放大缩小（浏览器 zoom）：无明显错位
  - 超宽/超高表格：headers 对齐且不抖动

- 性能测试
  - 高频拖拽列宽场景下，更新平滑（60fps 观察）
  - 渲染耗时：无明显掉帧

- 回归测试
  - 旧逻辑保留，flag 回退验证
  - 与 annotation panel 共存时层级正确

## 9. 风险与应对

- 容器选择错误导致无法被滚动条遮挡
  - 确保 Teleport 到 `.scroll-content-wrapper` 或直接作为其子元素
- 锚点 rect 误差（由于布局变换/边距）
  - `contextElement = tableEl` 保证 autoUpdate 与溢出检测正确；必要时轻微 offset 微调
- 高频更新引发抖动
  - 开启 `autoUpdate(animationFrame: true)`；手动 update 统一 rAF 合批

## 10. 迭代计划与时间

- D0：加入 feature flag；评审方案（本文件）；准备基建接口（0.5 天）
- D1：实现 `useAnchoredFloating`、`createVirtualRectAnchor`；POC 验证（0.5 天）
- D2：`TableColumnHeaders` 接入 Floating UI（0.5 天）
- D3：`TableRowHeaders` 接入 Floating UI；事件/MutationObserver 接入（0.5 天）
- D4：联调 QA（滚动/侧栏/列宽/zoom）与优化（0.5 天）
- D5：灰度上线与监控，保留回滚开关（0.5 天）

如果认可此方案，我可以直接落地 Phase 1（基建 + POC），随后按步骤替换列标与行标。
