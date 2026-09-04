 #  Linnya 批注系统架构文档

本文档详细阐述 Linnya 编辑器中批注（Annotation）的文档归属、布局与交互。

## 0. 文档归属与持久化

- 持久化事实只存在于 `rootBlock.attrs.annotations`，与正文共同进入同一个 `content_json` 文档版本。
- `useAnnotationStore` 从 `editor.state.doc` 派生 read model，并通过 ProseMirror transaction 完成新增、修改、解决、回复和删除。
- `creating` / `editing` 与面板 `position` 仅是 Renderer 临时态，不进入 Markdown profile。
- Markdown 导出把每条批注写成相邻的 `<!-- linnya-annotation:v1 ... -->`；普通 `<!-- comment -->` 导入时由 admission 边界补齐身份。
- 所有持久化新建都调用 `createMarkdownAnnotation()`，统一生成 `confirmed` 初态；用户确认只是把本地 `creating` draft 提交为正式批注，不是 Revision pending。
- Review 工具和 `edit_file` / `write_file` 最终都进入 Markdown Annotation 的统一 mutation 用例。普通 comment 创建批注；保持稳定 ID 修改 canonical comment 会编辑批注；删除 canonical comment 会删除批注；同次正文变化仍单独进入 Revision。
- Review 回流 transaction 标记为 `internal`：后端文档版本已经落库，Renderer 只合并新增批注，不再触发一次重复 autosave。
- Workspace `document.updated(incremental)` 回流会从后端文档精确同步现有块的 Annotation attrs，因此 file-style 的编辑与删除会立即反映到已打开 Editor；同步 transaction 同样标记为 `internal`，并保留本地正文。
- 禁止恢复 annotations 表、Annotation CRUD IPC 或另存一份 sidecar 数组，否则正文版本与批注会再次产生双真相。

## 1. 架构演进：从网格布局到独立浮动层

在开发过程中，我们探索了多种布局方案，最终选择了一种兼具灵活性和可维护性的模型。

### 1.1. 方案探索：全宽行与三栏网格布局 (已废弃)

我们最初曾尝试过一种“全宽行”的混合模型，该模型基于 CSS Grid 实现三栏布局：

```
[空白左翼] [主内容区] [批注区]
```

**优点**：
*   理论上，CSS Grid 可以完美处理内容与批注的对齐，避免滚动不同步的问题。
*   布局结构清晰，似乎更符合现代CSS的实践。

**遇到的问题**：
*   **实现复杂性高**：需要深度重构 `BlockView` 和 `rootBlock` 的渲染方式，将批注节点直接整合进 ProseMirror 的文档流 `NodeView` 中。
*   **布局 Bug**：在窗口缩放、内容动态变化时，频繁出现对齐错误和间距计算不准确的问题。
*   **点击失效**：遇到了难以调试的点击事件穿透和失效问题。
*   **维护困难**：CSS `calc()` 和 `clamp()` 的复杂组合使得样式难以预测和维护。

经过多次尝试，我们认为这种方案虽然理想，但实现成本和稳定性风险过高，因此决定放弃。

### 1.2. 当前方案：独立浮动层与同步滚动容器

我们最终回归并优化了“方案A”，并引入了一个关键的布局改进：**同步滚动容器**。

**核心思想**：
*   在可滚动的 `.editor-shell` 容器内部，我们引入了一个新的包装层 `.scroll-content-wrapper`。
*   这个包装器被设置为 `position: relative`，它的高度会由内部的编辑器内容（`.main-flow`）完全撑开，从而和整个可滚动文档等高。
*   关键在于，**内容区 (`.main-flow`) 和批注层 (`.annotation-layer`) 现在都是这个包装器的直接子元素**。
*   `.annotation-layer` 通过 `position: absolute` 和 `height: 100%`，变成了一个与文档内容**完全等高、且随之一同滚动**的透明浮层。

**优点**：
*   **坐标系统一**：内容和批注层处于同一个可滚动的坐标系中，从根本上解决了所有“滚动不同步”的问题。
*   **解耦**：依然保持了批注渲染与 ProseMirror 文档流的完全解耦。
*   **定位简化**：使得位置计算变得极其简单和健壮，不再需要复杂的 JavaScript 模拟滚动。

## 2. 核心定位系统

批注面板的精确定位是本系统的核心。它由多个模块协同工作，确保面板能始终与对应的文本块在垂直方向上对齐，并优雅地处理重叠。

### 2.1. 系统组件

*   `AnnoLayoutManager.js`: 布局系统的总协调器，提供统一的API接口。
*   `PanelPositionCalculator.js`: 负责计算单个批注面板的“理想”初始位置。
*   `PanelOverlapDetector.js`: **核心模块**，负责解决多个面板间的垂直重叠问题，并包含最终的位置计算逻辑和性能优化。
*   `PanelFinder.js`: 一个 DOM 工具类，用于高效地查找所需的元素（如 `.editor-shell`, 文本块等）。

### 2.2. 精确位置计算 (`calculateIdealPositionSync`)

面板的垂直定位 (`idealTop`) 是整个系统的关键。在我们实现了同步滚动容器之后，位置计算变得前所未有的简单和精确。

**最终采用的公式**：

```javascript
// in: PanelOverlapDetector.js
const idealTop = blockElement.offsetTop;
```

**公式解析**：
1.  `blockElement`: 这是目标文本块的 DOM 元素。
2.  `.offsetTop`: 这是一个原生的 DOM API，它返回当前元素相对于其 `offsetParent` (最近的、具有定位属性的祖先元素) 的顶部距离。
3.  **工作原理**：在我们的新布局中，`blockElement` 和批注面板的 `offsetParent` **都是同一个元素**：`.scroll-content-wrapper`。因此，`blockElement.offsetTop` 直接给出了文本块在这个共享容器内的精确垂直偏移量。我们把这个值直接赋给批注面板的 `top` 样式，就能实现像素级的完美对-齐。

**为什么这个方法更优越**：
*   **静态与稳定**：`offsetTop` 是一个静态值，它只在 DOM 结构变化时改变，而**不受滚动条位置的影响**。这彻底解决了之前所有因滚动而产生的定位 Bug。
*   **无需修正**：它自动处理了所有父元素的 `padding` 和 `border`，我们不再需要任何手动计算来修正偏移，比如之前那个 `- shellPaddingTop`。
*   **性能更佳**：读取 `offsetTop` 通常比调用 `getBoundingClientRect()` 并进行一系列计算要快。

### 2.3. 重叠避让算法 (`handlePanelOverlaps`)

当多个批注靠得很近时，它们的面板可能会重叠。我们采用了一个迭代算法来解决这个问题：

1.  **排序**：首先，根据批注对应文本块在 ProseMirror 文档中的先后顺序，对所有面板进行排序。
2.  **迭代调整**：
    *   从上到下遍历排序后的面板。
    *   对于每个面板，计算它的最小安全 `top` 值，该值必须大于或等于它前一个面板的底部 (`prevPanel.bottom`) 加上一个最小间距 (`MIN_PANEL_GAP`)。
    *   该面板的最终 `top` 值取 `Math.max(自己的理想top, 最小安全top)`。
3.  **循环直至稳定**：重复第二步，直到某一次遍历中没有任何面板的位置需要调整，此时布局达到稳定状态。
4.  **批量更新**：将所有计算出的最终位置批量更新到 `AnnotationStore`，触发视图更新。

## 3. 性能优化策略

在拥有大量批注的文档中，频繁的滚动事件可能导致性能问题。我们采用了两种关键技术来确保滚动体验的绝对流畅。

### 3.1. `requestAnimationFrame`：平滑渲染

所有由滚动事件触发的位置重算请求 (`recalculateAllPositions`) 都被包裹在 `requestAnimationFrame` (rAF) 中。

*   **作用**：`rAF` 将多次高频的滚动事件回调合并为一次，并安排在浏览器下一次重绘之前执行。
*   **优点**：
    *   **避免布局抖动**：防止在一帧内进行多次无效的计算和DOM读写。
    *   **提升流畅度**：确保动画（滚动）与浏览器的渲染周期同步，减少卡顿和掉帧。

### 3.2. `IntersectionObserver`：增量计算

这是最大程度优化性能的关键。我们不再在滚动时计算所有面板的位置，而只计算**当前可见**的。

*   **工作原理**：我们使用 `IntersectionObserver` 来高效地监听所有带批注的文本块 (`.root-block-outer`)。它会维护一个 `visibleBlockIds` 集合，其中只包含当前在视口（`.editor-shell`）中可见的块 ID。
*   **应用**：当 `recalculateAllPositions(false)` (滚动模式) 被调用时，它会先用 `visibleBlockIds` 过滤一遍，**只为那些当前可见的批注面板执行位置计算和重叠避让**。
*   **效果**：这极大地减少了滚动时的计算量。无论文档有多长、批注有多少，计算开销都只与当前屏幕上可见的批-注数量成正比，确保了在极端情况下的高性能表现。

在需要全局更新的场景（如拖拽移动块），我们会调用 `recalculateAllPositions(true)`，此时会临时跳过 `IntersectionObserver` 过滤，以确保整个文档的批注布局正确无误。

### 3.3. 与编辑器虚拟化的关系：当前不建议继续下钻改造

在编辑器虚拟化 Phase 3 研究中，我们专门评估过“批注系统是否要按激活块消费（只处理可见/激活块）”。结论是：**当前阶段不建议贸然修改批注系统**。

原因不是批注系统没有优化空间，而是它的核心布局能力本质上是一个**全局解算问题**，不能简单类比 CodeBlock / ImageBlock 这类“块内重 UI 按激活显隐”的优化方式。

#### 为什么风险高

1. **重叠避让是全局算法**
   - `PanelOverlapDetector.handlePanelOverlaps()` 会先按文档位置排序，再迭代计算所有面板的最终 `top`
   - 一个面板的位置取决于它前面所有相关面板的最终底边
   - 这意味着离屏面板虽然不在视口里，仍然可能影响屏内面板的最终布局结果

2. **当前系统仍然依赖“全量参与者”**
   - `AnnotationPanel.vue` 仍然会全量同步 `store.annotations` 并全量渲染面板
   - `PanelOverlapDetector` 虽然引入了 `IntersectionObserver`，但目前主要用于滚动态的局部更新过滤，最终仍会无条件进入 `handlePanelOverlaps()` 做全局重叠解算

3. **现有效果来之不易，回归风险极高**
   - 这套批注布局、同步滚动、重叠避让、编辑态稳定性，都是长期打磨的结果
   - 如果简单地把“离屏批注”从参与集合里移除，极易出现面板跳位、重叠关系突变、滚回时重新洗牌等体验回退

#### 当前判断

- **业务侧现状**：批注功能目前使用频率不高，短期内不会构成明显性能瓶颈
- **工程侧现状**：批注系统当前的复杂度、风险和已有视觉效果，使其不适合作为现阶段的优先优化对象
- **当前决策**：**先不推进“批注系统按激活块消费”改造**

补充：在 rootBlock 渲染虚拟化推进后，批注模块只接入两件低风险能力：

1. **交互保活声明**：`useAnnotationVirtualizationKeepAlive.ts` 会把创建中、编辑中、鼠标悬停中的面板按 `blockId` 汇总成集合，并通过 RenderVirtualization 的 `keepAliveEvents` 协议向 `editor.view.dom` 派发 `reason='annotation'`。这样 placeholder 虚拟化不会在用户正在操作批注时把目标块切走。
2. **Host 挂载层 read-model**：`readModel.ts` 暴露 `useAnnotationHandleSummary(blockId)` 和 `useAnnotationPanelPresence()`，分别服务 Host 的批注入口和全局批注面板挂载。Host 只决定“按钮 / 面板挂在哪里、是否需要挂载”，不接管批注布局算法、store 数据结构、重叠避让或持久化流程。

这不是说该方向永远不做，而是说在**没有明确性能瓶颈证据**之前，不应该为了理论上的一致性而破坏一个已经很稳定、很精妙的系统。

#### 未来什么时候再考虑

只有在满足以下任一条件时，才建议重启这项改造：

1. 出现真实的大文档场景，且单文档批注数量明显增长
2. 通过埋点或性能录制，确认瓶颈确实落在批注布局链路，而不是别的子系统
3. 有足够测试预算覆盖以下回归面：
   - 滚动时面板稳定性
   - 编辑态 / 创建态面板高度变化
   - 批注定位与滚动到目标块
   - 块拖拽、块删除、文档结构变化后的重排

#### 如果未来要做，建议先做什么

建议先做**观测与方案设计**，而不是直接改算法：

1. 增加埋点：批注总数、当前可见批注数、滚动期间重排次数、`handlePanelOverlaps()` 平均耗时
2. 明确“离屏批注”的语义：
   - 是否完全不参与避让
   - 是否保留最后一次位置
   - 是否只在激活窗口内做局部避让
   - 是否需要“隐藏但保留布局影响”的中间态
3. 先形成专项设计文档，再考虑落地实现

简而言之：**批注系统不是不能动，而是必须在有证据、有方案、有回归保障的前提下动。当前阶段，维持现状是更理性的选择。**

## 4. 模块职责与耦合分析

我们的定位系统被精心设计为一组**高内聚、低耦合**的模块。每个文件都有明确且单一的职责，通过清晰的API相互协作，共同完成复杂的布局任务。

### 4.1. 职责划分

#### `PanelFinder.js`
*   **职责**: **DOM查询器**。
*   **内聚性**: 极高。它的唯一任务就是根据选择器或ID查找特定的DOM元素（如`.editor-shell`、`.annotation-layer`、特定的块或面板），并提供获取元素尺寸（`Rect`）的统一方法。它不包含任何定位逻辑。
*   **耦合性**: 极低。它被其他模块依赖，但它自身不依赖任何其他模块。它是一个纯粹的、可复用的DOM工具。

#### `PanelPositionCalculator.js`
*   **职责**: **初始位置计算器**。
*   **内聚性**: 高。它的核心职责是计算单个批注面板**首次出现或需要重置时**的“理想”位置。它封装了计算初始`top`和`left`值的逻辑。
*   **耦合性**: 低。它依赖 `PanelFinder` 来获取DOM信息，并依赖 `PanelOverlapDetector` 来处理后续的重叠问题。它扮演着一个中间协调者的角色，但其自身的定位算法是独立的。

#### `PanelOverlapDetector.js`
*   **职责**: **布局解算与性能核心**。
*   **内聚性**: 高。这是系统中最复杂的模块，但其所有功能都围绕一个核心任务：**解决面板间的垂直重叠**。它内部包含了排序算法、迭代避让逻辑、最终位置的精确计算公式，以及所有性能优化措施（`IntersectionObserver`）。
*   **耦合性**: 低。它依赖 `PanelFinder` 来获取DOM信息，并依赖 `AnnotationStore` 来读写面板的最终位置。它不知道 `PanelPositionCalculator` 的存在，只专注于解决布局冲突。

#### `AnnoLayoutManager.js`
*   **职责**: **公共API外观 (Facade)**。
*   **内聚性**: 中等。它本身不实现任何复杂的逻辑，而是将底层模块（`Calculator`, `Detector`）的功能组合起来，为上层应用（如 `EditorContext.vue`）提供一个干净、统一的接口（如 `recalculateAllPositions`, `observeBlock` 等）。
*   **耦合性**: 低。这是**依赖倒置原则**的体现。上层应用只与 `AnnoLayoutManager` 这个稳定的接口交互，而不需要关心底层定位和重叠算法的复杂实现。这使得底层的实现可以被随意替换和优化，而不会影响到上层调用。

#### `AnnoLayoutPlugin.js`
*   **职责**: **ProseMirror文档变更监听器**。
*   **内聚性**: 极高。它是一个Tiptap/ProseMirror插件，唯一的作用就是监听文档的结构性变化（`docChanged`）。当变化发生时，它通过 `layoutManager` 的API触发一次全局的位置重算。
*   **耦合性**: 极低。它只知道 `layoutManager` 的 `recalculateAllPositions` 这一个方法。它不关心位置是如何计算的，也不关心重叠是如何解决的，只负责在正确的时机（文档变更后）发出“需要重新布局”的信号。

#### `BlockLifecycleExtension.js`
*   **职责**: **块生命周期监视器（数据完整性）**。
*   **内聚性**: 极高。专门用于监控 `rootBlock` 的删除操作。它在 ProseMirror 事务层面比较前后的文档快照，识别出被删除的块 ID。
*   **耦合性**: 极低。它不直接操作批注数据，而是通过发射通用的 `block-operation` (delete) 事件来通知系统。这确保了无论是通过键盘（Backspace/Delete）、剪切还是菜单命令删除块，都能触发统一的清理逻辑，保证批注数据不会残留。

### 4.2. 总结

这个系统是一个典型的**关注点分离 (Separation of Concerns)** 设计：

*   **DOM查询 (`Finder`)**、**初始定位 (`Calculator`)**、**冲突解决 (`Detector`)**、**外部接口 (`Manager`)**、**视觉更新 (`LayoutPlugin`)** 和 **数据清理 (`LifecycleExtension`)** 被清晰地分离开来。
*   数据流是单向且可预测的：
    *   布局更新：`LayoutPlugin` 触发 -> `Manager` 调用 -> `Detector` / `Calculator` 计算 -> 更新 `Store` -> 视图响应。
    *   数据清理：`LifecycleExtension` 检测删除 -> 触发 `block-operation` -> `BlockEventHandler` 响应 -> 调用 `AnnoDeleteCommands` -> 清理 `Store` 和 UI。
*   这种低耦合的设计使得系统非常健壮和可维护。例如，如果我们想改变重叠算法，只需要修改 `PanelOverlapDetector.js`；如果想改变触发时机，只需要修改 `AnnoLayoutPlugin.js`，而不会影响到其他部分。

结构树：

```
Annotation/
├── index.js
├── useAnnotationStore.js
├── BlockEventHandler.js
├── AnnoLayoutPlugin.js
├── AnnoHighlightState.js
├── commands/
│   ├── index.js
│   ├── AnnoStateCommands.js
│   ├── AnnoCreateCommands.js
│   ├── AnnoMoveCommands.js
│   └── AnnoDeleteCommands.js
├── config/
│   └── contextConfig.ts
├── extensions/
│   └── AnnoKeyboardExtension.js
├── keyboard/
│   └── AnnotationKeys.js
├── position/
│   ├── index.js
│   ├── PanelPositionCalculator.js
│   ├── PanelOverlapDetector.js
│   ├── PanelFinder.js
│   └── AnnoLayoutManager.js
├── ui/
│   ├── AnnotationDisplay.vue
│   ├── AnnotationEditor.vue
│   ├── AnnotationPanel.vue
│   ├── NewAnnotation.vue
│   └── AnnotationHandle.vue
└── utils/
    └── autoResize.js
```

## 5. 预留能力：批注回复（Reply API）

我们准备为批注增加“回复”能力，但当前阶段**只提供 API 入口**，不在正式 UI 中开放真实回复按钮（未来用于 AI 回复/协作回复）。

### 5.1. 数据规则

- **数据结构**：在 `Annotation` 对象中增加可选字段 `replies`（数组），每条回复包含 `id/content/author/createdAt`。
- **持久化**：回复随所属 Annotation 写入 `rootBlock.attrs.annotations[].replies`，复用文档 transaction 与自动保存链路。
- **命令层**：提供 `AnnoReplyCommands.ts` 的最小封装（例如 `appendAnnotationReply`），避免让 UI 直接操作 store 细节。

### 5.2. 开发期临时按钮（仅 DEV）

为了调试方便，我们在 `AnnotationDisplay.vue` 中增加了一个仅在 `import.meta.env.DEV` 下可见的临时按钮，用于触发“追加回复”的 API。

注意：该按钮仅用于开发调试，正式版本不提供回复入口。
