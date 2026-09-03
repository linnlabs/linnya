# Editor 渲染虚拟化下一代架构路线演进图

> 状态：阶段 2/3 已完成，本文档进入稳定维护态。本文档记录虚拟列表架构结论、验收门禁、维护边界和未来条件触发项，不再作为日常开发待办清单。
>
> 背景判断已在以下文档中沉淀，本文档建立在它们之上，不重复推导：
>
> - [`../features/RenderVirtualization/README.md`](../features/RenderVirtualization/README.md)：当前虚拟化架构分层、事实源、窗口规划、提交协议和协作边界。
> - [`perf-baseline-2026-Q2.md`](./perf-baseline-2026-Q2.md)：性能基线、自动压测记录和回归结论。
>
> 阅读建议：先看 RenderVirtualization README 建立实现心智模型，再看本文档的阶段路线；需要判断性能收益时再查性能基线。

---

## 0. 文档定位与读者

### 0.1 这份文档要回答的问题

1. 当前虚拟列表系统的**稳定架构结论是什么**？
2. 阶段 2/3 已经靠哪些**证据和门禁完成验收**？
3. 后续维护中有哪些**绝对不能破的不变量**？
4. 哪些方向**现在不主动做、但在证据触发时可以重新研究**？
5. 如何在**不继续增加长期 feature flag** 的前提下，维护现有 `virtualRootBlockRendering` 大文档运行态？

### 0.2 不在本文档范围内

- 具体 PR 拆分、测试用例清单、code review checklist：留给后续维护 issue 单独写。
- 与现有 architecture 文档的具体差异点对照：以 `RenderVirtualization/README.md` 和性能基线为准。
- 用户侧 UI 设计（浏览态长什么样、菜单怎么改）：阶段 4 触发时单独写产品设计文档。

### 0.3 读者

- 当前正在动 RenderVirtualization / BlockChrome / BlockView 任何一处代码的人：必读本文档第 4–8 节对应阶段。
- 评审性能相关 PR 的人：必读本文档第 10 节"跨阶段不变量"。
- 决定是否启动阶段 4（浏览/编辑双模式）的人：必读本文档第 8 节与第 11 节决策矩阵。

---

## 1. 共识基线

下面这些判断已经在多轮研究后形成共识，演进路线建立在它们之上。**任何后续讨论先确认是否仍然认可这几条，再讨论路线**。

### 1.1 五条共识

1. **当前 placeholder 虚拟化方向是对的**，不需要推翻重做。它已经把"离屏块成本"压到了相对合理的水平。
2. **当前最大的剩余成本不在离屏，而在入屏**。入屏窗口 220–480 个 `VueNodeViewRenderer(BlockView)` + 同等数量的 `BlockChrome` + 同等数量的 `editor.on('update'/'selectionUpdate')` 监听器，是已知的具体瓶颈。
3. **不是 Vue 不行，是 Tiptap Vue3 NodeView 的已知性能问题 + 我们的 BlockChrome 同生共死设计 叠加的结果**。换 React / Lexical 不能自动解决这条路径。
4. **产品目标应该重新定义为"浏览丝滑 + 当前块编辑丝滑"，而不是"1 万块同时完整编辑态丝滑"**。后者既无必要也无可能。
5. **架构演进应该走"渐进解耦"而不是"一次性双模式"**。先把 rootBlock 壳层从 Vue 响应式系统拿出来，再判断要不要继续到双模式。

### 1.2 路线收敛

`analysis` 文档列了 4 条路线（A 当前收割 / B 浏览编辑双模式 / C 换底层 / D 完全自研）。本路线图把它们**重新组织成阶段**而不是并列选项：

```text
阶段 0  观测基线 ───────────────────────┐
                                       │
阶段 1  当前架构收割（原路线 A 子集） ───┤
                                       │
阶段 2  裸 DOM RootBlock NodeView ─────┤  必走主线
        （analysis 第 12 节，外部报告  │  Vue → 原生 DOM 解耦的关键
         判断的最高杠杆方向）         │
                                       │
阶段 3  BlockChrome 中央化 + 按需挂载 ──┘
        （与阶段 2 协同必须做）

──── 决策点 1：阶段 1+2+3 完成后能否达成性能目标？ ────

   能 ─→ 路线收束于此，进入维护和上游跟踪。
   否 ─→ 进入阶段 4。

阶段 4  浏览/编辑双模式 POC（原路线 B，条件触发）

──── 决策点 2：双模式 POC 是否值得产品化？ ────

   值得 ─→ 产品化双模式，作为长期形态。
   不值得 ─→ 进入阶段 5。

阶段 5  长期演进选项（原路线 C/D + Vapor）
        （暂不启动，仅持续观察跟踪）
```

阶段 2/3 是**必走的**；阶段 4 是**条件触发的**；阶段 5 是**目前不做但持续跟踪的**。

### 1.3 开关治理原则

当前已经存在统一的大文档虚拟化入口：

```text
virtualRootBlockRendering = feature flag
virtualRootBlockRenderingActive = 当前文档运行态
DEFAULT_VIRTUAL_ROOT_BLOCK_THRESHOLD = 1500
```

后续阶段不再新增一组长期并列的顶层开关，例如 `useDomRootBlockNodeView`、`centralizedBlockChromeHost`、`renderVirtualizationLargeWindow` 这类名字不应作为长期产品开关存在。

正确口径是：

```text
1500+ rootBlock 进入同一个 RenderVirtualization 大文档运行态；
运行态内部逐步替换实现策略：
  Vue BlockView hydrated path
    -> DOM RootBlock NodeView hydrated path
    -> centralized BlockChrome host
```

允许的回退方式：

- 短期 PR 内部可以有局部 dev-only 断路或策略版本字段，用于灰度和排查；
- 这些断路必须挂在 `RenderVirtualization` 内部策略上，而不是新增全局永久 flag；
- 阶段完成后要删除临时断路，或收敛成当前运行态的唯一默认策略；
- 小文档仍然不进入 `virtualRootBlockRenderingActive`，不需要感知这些内部策略。

换句话说：

> 这不是在当前虚拟化旁边再造一套“新虚拟化开关”，而是在现有 1500 阈值虚拟化路径内部替换 hydrated NodeView 和 chrome 挂载策略。

---

## 2. 演进总图

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                            当前位置（baseline）                                │
│                                                                              │
│  ProseMirror doc                                                             │
│    └─ rootBlock × N (1500–10000)                                             │
│         ├─ (离屏)  PlaceholderShellView      ← 原生 DOM，已轻量              │
│         └─ (入屏)  VueNodeViewRenderer       ← 220–480 个，问题集中地        │
│              └─ BlockView.vue (Vue 壳)                                       │
│                  └─ BlockChrome.vue (5 个 composable + 6 个 watcher)        │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              阶段 0：观测基线（先把"问题在哪"从感觉变成证据）                  │
│              产物：5 组 benchmark + 5 个 perf 探针                            │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              阶段 1：当前架构收割（低风险快速收益）                            │
│  - 窗口块数压缩    - dragover rAF 节流                                       │
│  - shallowRef/markRaw 治理   - drop indicator 收口                          │
│  - 监听器收敛初步   - 异步组件化                                              │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              阶段 2：裸 DOM RootBlock NodeView（关键转折）                     │
│                                                                              │
│  rootBlock × N                                                               │
│    ├─ (离屏)  PlaceholderShellView                                           │
│    └─ (入屏)  RootBlockDomNodeView           ← 新建，原生 DOM                │
│                ├─ .root-block-outer                                          │
│                ├─ chrome anchor (空)         ← Vue Chrome 通过 host 挂这里  │
│                └─ contentDOM                  ← ProseMirror 渲染正文        │
│                                                                              │
│  RootBlockRuntimeRegistry (新建)             ← editor 级 registry            │
│    blockId -> { dom, contentDOM, getPos, pin, hydrate, getRect, measure }   │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│           阶段 3：BlockChrome 中央化 + 按需挂载（与阶段 2 协同）                │
│                                                                              │
│  EditorContent.vue                                                           │
│    ├─ <EditorContent />                                                      │
│    ├─ <BlockChromeHost />        ← 一个 Vue 组件，渲染 N 个 active chrome   │
│    ├─ <AnnotationOverlayHost />                                              │
│    └─ <FloatingMenuHost />                                                   │
│                                                                              │
│  active chrome ≈ 5–20 个，而不是 220–480 个                                  │
│  selection plugin 中央化：1 次 selectionUpdate → 通知 1–2 个 chrome         │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
                       ┌─────────────┴─────────────┐
                       │                           │
                       ▼                           ▼
       ┌───────────────────────┐    ┌──────────────────────────────────┐
       │  达成性能目标？        │    │  未达成？进入阶段 4              │
       │  路线收束               │    │  浏览/编辑双模式 POC             │
       │  转入维护 + 上游跟踪   │    │  （仅在阶段 1+2+3 不足时启动）   │
       └───────────────────────┘    └──────────────┬───────────────────┘
                                                   │
                                                   ▼
                                  ┌──────────────────────────────────────┐
                                  │  阶段 5：长期跟踪                     │
                                  │  Vapor 稳定后试点                    │
                                  │  Tiptap #6440 持续观察               │
                                  │  Lexical / 自研：仅 watch-only       │
                                  └──────────────────────────────────────┘
```

---

## 3. 跨阶段不变量

下面这些规则**不分阶段、必须永远成立**。任何 PR 违反这些不变量必须当场打回，不论它带来多少局部收益。

### 3.1 编辑语义不变量

1. **ProseMirror doc 永远完整**：虚拟化只在渲染层发生，doc 节点数 = 用户实际块数。
2. **selection 跨虚拟化边界一致**：用户从屏幕顶部选到底部，selection 内容必须完整、可复制、可剪切。
3. **IME / composition 期间不允许 dehydrate 当前块**：中日韩输入法的 composition session 必须看到稳定的 contentDOM。
4. **`coordsAtPos` / `posAtCoords` / `nodeDOM(pos)` 调用前必须保证目标 rootBlock 已 hydrate**：业务模块不允许对 placeholder 内部位置调这些 API。
5. **undo / redo 不感知虚拟化**：撤销跨 1 万块的操作必须正确还原。

### 3.2 性能不变量

1. **任何一次用户输入不允许导致 `O(totalBlocks)` 的 Vue 组件更新**。
2. **任何一次 `selectionUpdate` 不允许让 N 个 NodeView 自查自己是否被选中**。
3. **任何一次滚动帧不允许做 `doc.descendants` 全量遍历或全量 DOM query**。
4. **任何一次批注重排不允许对全文 comment 调 `coordsAtPos`**。
5. **任何一次 drag pointermove 不允许 dispatch ProseMirror transaction**。

### 3.3 协议不变量

1. **`RenderVirtualizationEngine` 是窗口事实源**：业务模块不允许自己监听滚动 + DOM sample + 维护"我以为已 hydrate"的副本。
2. **`keepAlive` 是租约语义**：同一块同一 reason 多次 acquire 必须有等量 release，不允许业务直接操作 `pinnedSet`。
3. **`scrollHandshake` 是 `blockId/pos → hydrate → 等 NodeView lifecycle → selection` 的唯一入口**：业务不允许逐帧轮询 DOM。
4. **transaction meta**：所有渲染/派生类 transaction 必须 `addToHistory=false`，不进 undo history。

### 3.4 演进不变量

1. **不允许在没有 benchmark 证据的情况下进入下一阶段**。
2. **不允许新增长期并列开关来承载阶段 2/3**：阶段改造必须复用现有 `virtualRootBlockRendering` 大文档运行态；如需回退，只允许短期内部策略断路，并在阶段收口时删除。
3. **不允许在阶段 2 完成前同时启动阶段 4**：架构上的"渐进解耦"要求 rootBlock 壳层先解耦。
4. **不允许把"短期能跑"当成"路线成立"**：每个阶段必须用 1500 / 5000 / 10000 三档真实数据回归。

---

## 4. 阶段 0：观测基线

> 状态：已完成首轮，持续补样本。
>
> 预计周期：1 周。

### 4.1 目标

把"editor 卡"这种感觉描述，**全部翻译成可分位数、可对比的 perf 样本**。没有 baseline，后续阶段的"是否达成目标"都是空话。

### 4.2 必须落地的 5 个 benchmark

每个 benchmark 都要跑 `500 / 1500 / 5000 / 10000 rootBlock` 四档：

1. **首开**：JSON parse → PM Node 构建 → EditorView 构造 → first paint → first hydrated window ready。
2. **滚动**：从顶部连续滚到底部，记录 p50 / p95 / p99 帧时间、long task 数、hydrate/dehydrate 次数、scroll anchor correction 次数。
3. **当前块输入**：在顶部 / 中部 / 底部分别测 keydown → next paint。IME composition 单独测一组。
4. **selection**：连续按方向键跨 100 块，记录 `selectionUpdate` 回调总次数、`NodeView.update` 调用次数、`getPos()` 调用次数。
5. **拖拽**：从顶部拖一个块到底部，记录 dragover 总次数、平均 dropPosition 计算耗时、是否出现帧时间 > 50ms 的样本。

### 4.3 必须补齐的 5 个 perf 探针

复用现有 `window.__*_PERF__` 模式，缺什么补什么：

- `__BLOCK_CHROME_LIFECYCLE_PERF__`：每个 BlockChrome mount/unmount 耗时与累计。
- `__EDITOR_LISTENER_PERF__`：editor 上的 `update / selectionUpdate / transaction` 监听器总数（实时）。
- `__VUE_NODEVIEW_PERF__`：当前活跃的 `VueRenderer` 实例数 + 累计构造耗时。
- `__BLOCK_ACTIVATION_PERF__`：当前 `isUiActive=true` 的 chrome 数量、按 reason 分类。
- `__DECORATION_SET_PERF__`：批注 + 修订 + active block class 的 decoration 总数和重建次数。

阶段 0 已先落地第一批观测入口：

- `__VUE_NODEVIEW_PERF__`：当前先跟踪 Vue `BlockView` 壳的 active/mount/unmount 数；后续 `RootBlockDomNodeView` 接入同一探针，形成 Vue 壳与 DOM 壳的前后对照。
- `__BLOCK_CHROME_LIFECYCLE_PERF__`：记录 BlockChrome mount/unmount、活跃数量和 setup 到 mounted 的耗时。
- `__BLOCK_ACTIVATION_PERF__`：记录当前 active chrome 数量和 `visible/focused/hovered/history-mode/keep-alive` 等原因分布。
- `__EDITOR_LISTENER_PERF__`：当前先记录 BlockChrome 安装的 `update/selectionUpdate` 监听器数量；后续 selection 事实源中央化时用它验证 N×2 是否收敛到 1。

已补充：

- `__DECORATION_SET_PERF__` 已落地基础版本：当前先接入 `render-virtualization` 和 `placeholder` 两个入口，记录 decoration 数量、构建耗时和访问节点数。后续再扩展到 FindReplace / Table / Citation 等 feature decoration。

尚未落地：

- 全局 editor listener monkey-patch 级别的完整统计
- 自动 benchmark runner 的 selection / 输入 / 拖拽专项；首开 / menu / annotation / scroll 四档压测与 compact summary 已能使用。

### 4.4 退出条件

- 5 个 benchmark 在 4 档数据上各跑 3 次，结果写入 `docs/perf-baseline-2026-Q2.md`（新建）。
- 5 个探针挂到 `window.__*_PERF__`，devtools 能取到。
- 团队在 baseline 数据上达成共识："最大的两个瓶颈是 X 和 Y"。

### 4.5 风险

- benchmark 跑不出可重复结果（Electron 主进程、IPC、其他后台任务影响）：必须在固定状态下跑（关闭 dev tools panel、关闭 LSP、关闭其他 renderer）。
- 探针自身造成性能影响：所有 perf sample 默认只写内存 ring buffer，不刷 console，禁止在 hot path 里做 `JSON.stringify` 或字符串拼接。

---

## 5. 阶段 1：当前架构收割

> 状态：阶段性完成，剩余问题已经触发阶段 2。
>
> 风险等级：低。改动局部。回退优先靠小 PR、可逆改动和 perf 对照，不新增长期全局开关。

### 5.1 目标

不动架构，把已知的几个具体热点修掉。这一阶段单独做就能让万行场景上一个台阶；同时它的产物也是阶段 2 的"对照组"。

### 5.2 必做项

按性价比排序：

#### 5.2.1 窗口块数压缩（半天）

```ts
// renderVirtualizationConstants.ts
MIN_RENDER_WINDOW_BLOCK_COUNT  220 → 100
MAX_RENDER_WINDOW_BLOCK_COUNT  480 → 200
DEFAULT_RENDER_WINDOW_OVERSCAN_VIEWPORTS  1.5 → 0.75
```

回退：这是 `RenderVirtualization` 现有窗口策略参数调优，不新增独立开关。若调参后出现白屏或跳动，直接在同一 PR 或后续修复 PR 中恢复参数，并保留 perf 对照记录。

#### 5.2.2 dragover rAF 节流（半天）

`DropCursorPlugin.js` 的 `handleDragOver` 改为 rAF 合批，`VIEWPORT_SAMPLE_Y_OFFSETS` 从 7 个砍到 3 个。

回退：无需 feature flag，直接观察 `__EDITOR_DRAG_PERF__`。

#### 5.2.3 BlockChrome 监听器收敛（2 天）

`BlockChrome.vue` 里的 `editor.on('update', checkIfFocused)` 和 `editor.on('selectionUpdate', checkIfFocused)` 拆掉。改用：

```text
EditorContext 顶层挂一次 selection plugin
  → 计算 currentFocusedBlockId
  → 通过 provide/inject 注入
  → BlockChrome 改成 inject 而不是 on
```

监听器数量从 N × 2 降到 1。

回退：这是 editor 级 selection 事实源的内部实现替换，不新增长期开关。实施时用小 PR 保持旧实现可快速 git 回滚；如果确实需要临时断路，只允许 dev-only，不进入 `editorFeatureFlags.ts`。

#### 5.2.4 shallowRef / markRaw 治理（2 天）

针对以下对象逐一审查：

- `annotationStore.annotations`：改 `shallowRef`，修改时整体替换。
- 所有传入 Vue 组件 props 的 `ProseMirrorNode` / `Decoration` / `EditorState`：入口处 `markRaw`。
- `revision` canonical pending map / list：检查是否在 `reactive` 里。
- block history list：检查是否在 `reactive` 里。

每改一个都跑阶段 0 的 selection / 输入 benchmark 验证。

#### 5.2.5 异步组件化（1 天）

`BlockChrome.vue` 里 `HistoryTimeline / HistorySideBySide / HistoryOverlay / AlertDialog` 改为 `defineAsyncComponent`。这些组件用户首次需要时才加载和实例化。

### 5.3 不做项

- **不重写批注算法**：`analysis` 文档已经说明这是高风险区，没有 benchmark 证据指向它之前不动。
- **不改 keepAliveRegistry 协议**：它现在工作正常。
- **不动 RootBlockShellView**：保留作为非虚拟化压测路径。

### 5.4 退出条件

- 5 个 benchmark 在 10000 块上的 p95 帧时间相对阶段 0 baseline 至少改善 30%。
- 拖拽场景 `__EDITOR_DRAG_PERF__.getLast()` 显示 dragover 单次耗时 p95 < 4ms。
- BlockChrome 活跃监听器数从 N × 2 降到 1（或 ≤ activeChromeCount × 2）。
- 没有任何已有功能回归（批注、修订、拖拽、菜单、AI 写入、表格全部回归）。

### 5.5 失败信号 / 回退

如果监听器收敛后出现"块焦点状态不同步"，**立刻**回滚该小 PR，回到旧 `editor.on` 模式，再细化排查。不允许带着 bug 进入阶段 2。

---

## 6. 阶段 2：裸 DOM RootBlock NodeView

> 状态：已完成。`virtualRootBlockRenderingActive=true` 的大文档 hydrated rootBlock 已默认走 `RootBlockDomNodeView`；runtime handle、NodeView lifecycle 与高度缓存已经按 editor owner 隔离，旧无 owner fallback 只保留测试 / legacy adapter 边界。
>
> 风险等级：中。改动核心 NodeView 链路，必须有并行 benchmark 和清晰回滚路径；但不新增长期并列 feature flag。
>
> 预计周期：3–4 周。
>
> **这是整条路线最高杠杆、也是技术风险最集中的阶段。整张演进图的"路口"在这里。**

### 6.1 目标

把 rootBlock 壳层从 `VueNodeViewRenderer` 中拿出来，改为原生 DOM NodeView。`PlaceholderShellView` 保留不变，新增一个 `RootBlockDomNodeView` 作为 hydrated 路径。

预期效果：

- VueRenderer 构造器调用次数：220–480 → 0（壳层不再走 `VueNodeViewRenderer`）。
- 入屏块的 Vue 组件实例数：220–480 → 0（壳层）+ 全局 Host 少量 surface（按 active block 挂载）。
- Tiptap `#5031 / #6440` 影响在我们项目上**完全绕过**。

### 6.2 新增 NodeView 形态

```text
hydrated rootBlock:
  <div class="root-block-outer" data-id="..." data-node-type="rootBlockOuter">
    <div class="root-block-chrome-anchor" contenteditable="false"></div>
    <div class="root-block">
      <div class="content"></div>   ← contentDOM，PM 渲染正文
    </div>
  </div>

placeholder rootBlock（不变）:
  <div class="root-block-outer root-block-placeholder"
       data-id="..." data-placeholder="true" style="height: ...px"></div>
```

### 6.3 必须迁移的 RootBlock 壳职责

`BlockView.vue` 退役为壳层后，下列职责必须由 `RootBlockDomNodeView` 接管（缺一不可）：

1. **DOM 结构搭建**：`.root-block-outer / .root-block / .content / chrome anchor` 四层 DOM。
2. **属性同步**：`data-id / data-node-type / data-background-color / data-text-color / data-position`，以及 hydrated/placeholder mode class。
3. **生命周期事件**：mount/unmount 必须发布到 `nodeViewLifecycle`，mode 切换时按 PM NodeView 契约返回 `false` 让 PM 重建。
4. **可见性注册**：注册到 `blockVisibilityManager`、`AnnoLayoutManager.observeBlock`。
5. **高度回写**：hydrated 后真实高度写回当前 editor owner 对应的 `BlockHeightCache`，禁止回退到跨 editor 共享的当前文档单例。
6. **Chrome anchor**：暴露一个稳定的 DOM 锚点，给 `BlockChromeHost`（阶段 3 实现）挂 Vue chrome。

### 6.4 新建 editor-scoped runtime tables

这是阶段 2/3 的关键基础设施。原生 NodeView 不能用 Vue `provide/inject`，必须建立显式端口；runtime handle、NodeView lifecycle 和高度缓存都必须按 editor owner 隔离：

```ts
// features/RenderVirtualization/runtime/RootBlockRuntimeRegistry.ts
interface RootBlockRuntimeRegistry {
  register(blockId: string, handle: RootBlockHandle): void
  unregister(blockId: string): void
  get(blockId: string): RootBlockHandle | null
  forEach(cb: (handle: RootBlockHandle) => void): void
}

interface RootBlockHandle {
  blockId: string
  getDom(): HTMLElement
  getContentDom(): HTMLElement | null  // placeholder 时为 null
  getChromeAnchor(): HTMLElement | null
  getPos(): number                       // 调用时计算，不响应式化
  getRect(): DOMRect
  pin(reason: string): () => void        // 返回 unpin
  hydrate(reason: string): Promise<void>
  measure(): number
}
```

挂载点：`editor.storage.rootBlockRuntime.registry`（通过 extension options 注入）。

**关键约束**：`RootBlockHandle` 不允许包含响应式状态。`getPos / getRect` 都是 action-time API，不是 render-time prop。这是为了避免重蹈"`getPos` 作为响应式 prop 导致前方编辑后所有节点重渲染"的覆辙。

selection keep-alive 已纳入同一租约模型：`selectionUpdate / engine refresh -> KeepAliveRegistry(reason='selection') -> pinnedSet`。plugin state 已移除 selection 保活字段，不再维护第二事实源；诊断入口如需显示当前选区，只从 ProseMirror selection 现算。`selectionKeepAlive.design-gate.test.ts` 已转正，覆盖 selection transaction、选区移动和多租约不互相误释放。

### 6.5 实施步骤

按顺序，每一步独立可回退：

#### Step 1：先实现 RootBlockHandle（1 周）

不动现有 NodeView，先建 registry + handle，让现有 `BlockView.vue` 也注册一份 handle 上去。**此时还没有任何性能改进**，但所有依赖 `BlockView` 内部状态的业务模块（annotation host、drag、handshake）都改成通过 registry 取数据。

退出条件：
- 现有功能 100% 不变。
- annotation / drag / handshake / pending projection 全部走 registry。

#### Step 2：实现 RootBlockDomNodeView（1 周）

在 `RootBlock.addNodeView` 里新增一个分支：

```ts
addNodeView() {
  return (props) => {
    const mode = resolveRootBlockRenderMode(...)
    if (mode === 'placeholder') return new PlaceholderShellView(...)
    if (shouldUseVirtualRootBlockRendering()) return new RootBlockDomNodeView(...)
    return new VueNodeViewRenderer(BlockView)(...)  // 小文档旧路径
  }
}
```

这里复用现有 `virtualRootBlockRenderingActive` 运行态：只有已经进入 1500+ 大文档虚拟化路径的文档，hydrated rootBlock 才从 Vue `BlockView` 切到 `RootBlockDomNodeView`。不新增 `useDomRootBlockNodeView` 这类全局开关。

退出条件：
- 大文档虚拟化路径下，hydrated 块的 DOM 结构和旧路径完全一致（用 DOM diff 工具校验）。
- 所有交互（点击、输入、IME、拖拽、复制粘贴）行为不变。
- BlockChrome 在新路径下**暂时不挂**（阶段 3 才挂），先验证裸壳层本身能跑。

当前落地状态（2026-05-20）：

- `RootBlock.addNodeView` 已经在 `virtualRootBlockRenderingActive=true` 且 mode 为 hydrated 时返回 `RootBlockDomNodeView`。
- `RootBlockDomNodeView` 已接管 `.root-block-outer / .root-block / .content / chrome anchor` DOM 结构、属性同步、runtime handle 注册、`nodeViewLifecycle` 事件和基础 `ignoreMutation` 规则。
- 普通小文档仍保留 `VueNodeViewRenderer(BlockView)`，非虚拟化 Shell 压测路径仍保留 `RootBlockShellView`。
- 当前裸 DOM 壳不挂每块 Vue `BlockChrome`，这是有意的阶段边界：滚动热路径先从 Vue NodeView 解耦，块级 chrome 在阶段 3 通过中央化 host 恢复。

下一轮必须验证：

- 5000 scroll 手动拖动滚动条时，`finalNodeView.activeByKind.vue` 应显著下降，`activeByKind.dom` 成为主要 hydrated 壳。
- 自动摘要中 `open.nodeViewStats.rootBlockDomNodeViewCount` 应接近初始 hydrated 数，`rootBlockVueNodeViewCount` 应接近 0（普通正文子 NodeView 不算 rootBlock 壳）。
- 点击正文、输入、IME、复制粘贴和 selection handshake 不回归；块级菜单 / 批注按钮若缺失，按阶段 3 处理，不在阶段 2 用每块 Vue chrome 补回去。

#### Step 3：把 BlockChrome 用一个全局 host 重新挂上（阶段 3）

见第 7 节。

#### Step 4：灰度切换（1 周）

灰度口径不新增开关，仍然沿用现有 rootBlock 阈值与大文档运行态：

```text
500 块以下：保留旧路径，小文档不进入 virtualRootBlockRenderingActive
1500–3000 块：进入现有虚拟化路径，hydrated 策略切到 RootBlockDomNodeView
5000+ 块：同一虚拟化路径，不再另设开关
```

退出条件：
- 5 个 benchmark 在 10000 块上 p95 改善至少 50%（相对阶段 0）。
- 无任何已有功能回归。
- 灰度 1 周无线上崩溃。

### 6.6 风险登记

| 风险 | 等级 | 应对 |
|------|------|------|
| `contentDOM` mode 切换时 PM ViewDesc 错乱 | 高 | mode 变化在 update 中 return false，让 PM 重建 NodeView；不在同一 NodeView 实例内增删 contentDOM |
| `ignoreMutation` 过度 ignore 导致 IME / 粘贴异常 | 高 | chrome anchor 区域设 `contenteditable=false`，对该区域 mutation return true；contentDOM 内部 mutation 必须 return false |
| Vue provide/inject 边界被破坏 | 中 | 所有原依赖 inject 的能力改走 registry。registry 提供 `subscribe(blockId, listener)` 用于状态变化通知 |
| 原生 NodeView 无法响应 `editor.commands` 触发的属性更新 | 中 | update 钩子内手动 diff `node.attrs` 与上次值，按需更新 DOM 属性 |
| 高度 cache 在 mode 切换边界跳变 | 中 | hydrate 前先把 placeholder 高度写到 outer style；hydrate 后下一帧再 remeasure |
| 现有 30+ Tiptap 扩展中有些依赖 `getNodeView` 返回 Vue 实例 | 低 | 阶段 0 必须 grep 整个仓库，列出所有 `nodeView` 依赖项；不允许遗漏 |

### 6.7 不做项

- **不改 PlaceholderShellView**：它已经很轻。
- **不动 ProseMirror plugin 协议**：`renderVirtualizationPlugin` 继续做 hydrated/pinned 事实源。
- **不动 keepAliveRegistry / scrollHandshake / nodeViewLifecycle**：这些是 registry 的下游，先保持稳定。
- **不在阶段 2 内做浏览/编辑双模式**：那是阶段 4 的事。

### 6.8 退出条件（同时满足）

1. 现有 `virtualRootBlockRenderingActive=true` 的大文档默认 hydrated 路径是 `RootBlockDomNodeView`。
2. 5 个 benchmark 全部达成"baseline 改善 ≥ 50%"或绝对值达成阶段验收口径（见第 9 节）。
3. Tiptap upstream 即使新版本回归 `#6440` 类问题，对我们没有影响（因为我们已经绕开 `VueNodeViewRenderer` 主路径）。
4. `__VUE_NODEVIEW_PERF__` 显示活跃 VueRenderer 数 ≈ 0（壳层）+ active chrome 数（≤ 30）。

---

## 7. 阶段 3：BlockChrome 中央化 + 按需挂载

> 状态：收口回归中。`BlockChromeHost` 已经在 rootBlock 渲染虚拟化运行态下接管 left-handle、annotation-handle、annotation-panel 挂载层、revision-indicator、revision-toolbar 和 history-panel。当前重点不是继续扩 surface，而是用 1500/5000/10000 回归确认阶段 2/3 的架构收益稳定成立。
>
> 风险等级：中。改动块级 UI 入口，但有阶段 2 的 registry 撑腰。
>
> 预计周期：2–3 周。

### 7.1 目标

把当前"每个 hydrated 块挂一个 BlockChrome"改成"全局一个 ChromeHost，只渲染 active 块的 chrome"。

active chrome 数从 220–480 降到 5–20。

### 7.2 中央化方案

```text
EditorContent.vue
  ├─ <EditorContent />        ← ProseMirror 渲染区
  ├─ <BlockChromeHost />      ← 新增：一个 Vue 组件，渲染 N 个 chrome
  ├─ <AnnotationPanel />       ← 已由 BlockChromeHostAnnotationPanel 挂载到 annotation-layer
  └─ <FloatingMenuHost />     ← 重构后的菜单宿主
```

`BlockChromeHost` 内部维护的 active chrome 输入模型已经先落到 `ui/blockChromeHost`：

- `definitions/activeChromeBlocks.ts` 定义来源契约；
- `functions/resolveActiveChromeBlocks.ts` 负责稳定排序、去重和来源合并；
- `functions/resolveBlockChromeRenderPlans.ts` 负责把 active block 转成当前可渲染的 surface plan；
- `useActiveChromeBlocks.ts` 是 Vue 薄连接层。
- `BlockChromeHost.vue` 已在 `EditorContent.vue` 挂载，并在大文档虚拟化路径渲染最小 chrome surface；Host 快照仍保留为 perf 观测，用来确认 active block 输入是否合理。
- `window.__BLOCK_CHROME_HOST_PERF__` 暴露 Host 输入快照，用于和旧 `__BLOCK_ACTIVATION_PERF__` 对照。

每个 active blockId 对应一组轻量 Host surface，通过 `registry.get(blockId).getChromeAnchor()` 或对应 runtime mount 拿到挂载锚点，用 Teleport 渲染过去。不要把旧 `BlockChrome.vue` 整体搬进 Host；小文档 / 非虚拟化路径继续保留旧 `BlockView + BlockChrome` 作为回归边界。

### 7.3 BlockChrome props 极简化

为了避免"chrome 数量少了但每个 chrome 仍然全量响应"，必须严格收口 props：

```ts
interface BlockChromeProps {
  blockId: string
  // 不允许传 node / decorations / editor / selection / annotationStore
}
```

业务数据由 selector 按需获取：

```ts
const commentSummary = useCommentSummary(blockId)
const revisionSummary = useRevisionSummary(blockId)
const dragState = useBlockDragState(blockId)
```

每个 selector 内部确保**只在 blockId 相关数据变化时**才触发更新。

### 7.4 实施步骤

#### Step 1：定义 active block 源（3 天）

状态：已完成。`ui/blockChromeHost` 已收口 hover / selected / focused / menu / drag / annotation / revision / history / keep-alive 九个来源，并保留 Host 快照观测 hovered / focused / selected / menu-open / dragging / annotation / revision-toolbar / history-mode / keep-alive 九类来源；同时生成 left-handle / annotation-handle / revision-toolbar / history-panel 的 render plan。大文档 rootBlock 渲染虚拟化运行态下，Host 已接管最小 left-handle（拖拽 + 菜单入口 + 历史版本入口）、annotation-handle（批注入口）、revision-indicator（修订状态行）、revision-toolbar（块级接受 / 拒绝按钮）和 history-panel（历史模式头部 / 面板 / 时间轴）；全局 annotation-panel 的挂载权也已从 `EditorContent` 收束到 Host，但批注面板内部逻辑仍保留在 Annotation feature。

`left-handle` 的第一条 read-model 边界已补上：`BlockHistory/readModel.ts` 暴露 `useBlockVersionHandleSummary(blockId)`，只返回版本按钮展示所需的 `hasHistory / versionCount / latestVersionNumber`，不把 `editor / node / getPos` 带进 Host。

`left-handle` 的菜单命令边界已补上：`blockActionMenu/functions/buildBlockMenuContextFromRootBlockId.ts` 以稳定 `rootBlockId` 为入口，通过当前 ProseMirror doc 的 `blockPosIndex` 重建 `BlockMenuContext`；`blockActionMenu/orchestration/openBlockActionMenuForRootBlockId.ts` 统一处理 open / toggle。旧 `useBlockDragAndMenu` 已切到同一入口，后续 Host 接管菜单时不再需要透传 NodeView 的 `node / getPos`，也不需要直接读写菜单 service。

`left-handle` 的拖拽命令边界也已补上第一刀：`extensions/interaction/drag/dragUtils.js` 暴露 `handleDragStartByRootBlockId` / `handleDragEndForEditor`，旧 `useBlockDragAndMenu` 已改为按 `editor + blockId` 发起拖拽，不再把 NodeView 的 `getPos` 传进拖拽命令。

`left-handle` 的拖拽 UI 生命周期已收口到 `extensions/interaction/drag/rootBlockDragLifecycle.ts`：旧 `useBlockDragAndMenu` 和 Host left-handle 复用同一套文本选择禁用、hover 抑制、全局 dragover/drop listener 与 drop indicator 清理逻辑。Host left-handle 拖拽期间额外通过 `useRenderVirtualizationKeepAliveLease` 声明 `dragging` 租约，避免拖拽源块在虚拟化窗口切换中丢失。

`left-handle` 的历史版本命令边界已补上：`BlockHistory/orchestration/ensureBlockHistoryLoadedForRootBlockId.ts` 负责按 `documentNodeId + blockId` 预取版本摘要数据，`BlockHistory/orchestration/toggleBlockHistoryForRootBlockId.ts` 统一打开 / 关闭历史模式。旧 `useBlockVersionHandle` 与 Host left-handle 已共用这条入口，避免 Host 反向依赖 History UI 组件或 NodeView props。

`left-handle` 的最小 Host UI 桥已补上：原生 RootBlock 的 `.root-block-chrome-anchor` 归位到 `.root-block` 内，`resolveBlockChromeRenderTargets()` 在 action-time 解析 Teleport 目标，`BlockChromeHostLeftHandle.vue` 已接管拖拽、菜单入口和历史版本入口。历史面板本体作为 `history-panel` surface 单独迁移，不和入口耦合。

`annotation-handle` 的最小 Host UI 桥已补上：`Annotation/readModel.ts` 暴露 `useAnnotationHandleSummary(blockId)`，Host 只读取当前块批注列表用于图标状态和点击语义；`BlockChromeHostAnnotationHandle.vue` 只 Teleport 右侧批注入口按钮，创建批注仍走 `EditorContext` 提供的 `triggerAnnotationCreate` 编排。

`annotation-panel` 的挂载权已收束到 Host：`Annotation/readModel.ts` 暴露 `useAnnotationPanelPresence()`，Host 只根据当前是否存在批注面板决定是否把 `AnnotationPanel` Teleport 到 `.annotation-layer`。面板内部的编辑、删除、AI 动作、重叠避让、布局计算、持久化和 hover keep-alive 仍全部留在 Annotation feature；这一步只去掉 `EditorContent` 对批注面板的直接挂载责任，不做批注算法改造。

`revision-indicator` 的最小 Host UI 桥已补上：裸 DOM RootBlock NodeView 暴露 `.root-block-revision-header` 文档流挂载点，Host 用 `canonical pending blockIds ∩ hydratedBlockIds` 决定哪些当前水合块要显示常驻修订状态行，`Revision/functions/readRevisionIndicatorSummary.ts` 只把 canonical pending 转成展示摘要，`BlockChromeHostRevisionIndicator.vue` 复用 `RevisionIndicator` 渲染。这个 surface 不属于 hover / focus active chrome，不调用 `getRevisionState()`、不扫描 mark、不触发 pending 投影，也不承接接受 / 拒绝命令；后续修订工具栏仍作为独立 surface 迁移。

`revision-toolbar` 的最小 Host UI 桥已补上：`RevisionOverlayLayer` 继续作为 hover / selection 判断的单一来源，只发布需要显示 toolbar 的 blockId；虚拟化主路径中 Overlay 不再渲染按钮，`BlockChromeHostRevisionToolbar.vue` Teleport 到当前 `.root-block` 右上角，点击通过 `Revision/orchestration/applyBlockRevisionToolbarAction.ts` 回到 Revision feature。这样 Host 不复制 pending / selection 规则，也不直接操作 RevisionStore。

`history-panel` 的 Host UI 桥已补上：`BlockHistory/readModel.ts` 仍然只发布处于历史模式的 rootBlock；`BlockChromeHostHistoryPanel.vue` 直接 Teleport 到当前 `.root-block`，渲染历史头部、右侧对比面板、覆盖预览和时间轴，并通过 `history-mode` keep-alive 租约保证当前块不被释放。恢复版本通过 `BlockHistory/orchestration/restoreBlockHistoryVersionForRootBlock.ts` 执行，恢复前是否需要“保存当前内容快照”的判断在 `BlockHistory/functions/readBlockHistoryPanelState.ts`，Host 不直接拼装版本恢复规则。

### 7.5 阶段 3 收口回归门禁

阶段 3 不以“能打开”为完成标准，而以“旧 BlockChrome 职责已经迁到 Host，且大文档路径没有 UI 回归”为完成标准。每次阶段 3 收口改动后至少跑下面这组：

| 场景 | 建议规模 | 观察点 | 通过标准 |
|------|----------|--------|----------|
| 首开 | 1500 / 5000 / 10000 | `open.setContentMs`、`finalNodeView.vue`、`finalDom.hydratedDom` | 1500 首开保持约 1s settle；Vue NodeView 只剩极少壳层 / Host，不回到每块一个 Vue |
| 原生滚动条拖拽 | 5000 起步，再外推 10000 | 手动反复上下拖动滚动条；`scrollHeightDelta`；`renderVirtualization.duration.p95` | thumb 跟手，不再持续脱离鼠标；拖拽中内容允许延迟，松手后补齐 |
| pending header | 1500 pending 起步 | header 文档流位置、宽度、toolbar hover、接受/拒绝 | header 始终在块顶部文档流内，不用 margin/absolute 伪占位；toolbar 不误触发全量投影 |
| history | 1500 文档中任意 hydrated 块 | 版本入口、历史头部、右侧面板、恢复确认 | Host 只承载挂载和点击入口；恢复规则仍回 BlockHistory orchestration |
| annotation | 1500 文档中任意 hydrated 块 | 批注入口、创建、面板显示、hover 保活 | Host 不接管面板算法；创建和面板仍走 Annotation feature，目标块不被虚拟化提前释放 |
| 拖拽 | 1500 / 5000 | left-handle 拖拽、drop indicator、dragend perf | 拖拽中源块 keep-alive；dragend 可以有一次性成本，但 pointermove 不持续卡顿 |

DevTools 常用观察入口：

```js
window.__BLOCK_CHROME_HOST_PERF__?.getSnapshot()
window.__EDITOR_DRAG_ACTION_PERF__?.getLast()
window.__REVISION_PENDING_PERF__?.getLast()
window.__EDITOR_PERF_BENCH__.auto.openDetached({ blockCount: 1500 })
```

pending 回归建议先清再注入：

```js
await window.__REVISION_TEST__.clear()
await window.__REVISION_TEST__.inject(1500)
```

2026-05-20 记录：1500 pending 注入已经稳定通过，后端写入与读回均为 `1500/1500`，前端 canonical session 数量为 `1500`，首开投影保持 `activeRevisionCount=0`、`RevisionPerf.totalMs≈4ms`。这证明阶段 3 的 pending 回归已经满足“全局事实源完整、首开不全量投影”的门禁。当前遗留问题是：远距离滚动到尚未 active 投影的区域时，行内 pending 视图会在 hydrate 后延迟出现。下一步只优化可见窗口 pending projection 的调度优先级与批次策略，不能回退到全量 `revisionMark` 投影。

5000 pending 外推样本也已通过第一轮手测：远距离滚动后窗口保持 `visible/hydrated≈90`，pending projection 按 `8 blocks` 分批补齐，典型批次约 `31–39ms`，最终窗口进入 `no-candidates / skippedActiveCount≈90`，用户体验可接受。该样本证明可见窗口优先策略没有漏投影；但单批耗时已经高于一帧，10000 外推时应重点观察 projection batch duration，而不是继续调整首开或滚动条策略。

10000 pending 外推暴露出新的阶段边界：窗口规模仍稳定、投影没有漏，但 `8 blocks` 批次出现 `1185.9ms` 冷启动峰值（`candidateCount=62`、`projectedCount=8`），后续仍有 `129–137ms` 级别批次。阶段 3 的滚动条/窗口机制不应回退；下一步应把专项收敛到 pending projection 热路径：批内 Markdown runtime / RichDiff / ProseMirror transaction 的耗时拆解，以及基于规模或耗时反馈的动态 batch size。

复测记录：plain text fast path 放宽后，压测文本中的行内 `#` 与裸 `[]` 不再误触发 `runtime-single-block`，10000 pending 最近批次均为 `slowestSource=plain-text-fast-path`、`resolve=0`。8-block 批次从秒级/百毫秒级降到约 `20–69ms`，尾批 `5 blocks≈17ms`。阶段 3 的主要风险已从 Markdown runtime 冷启动转为批次调度等待、定位和 dispatch 常数；后续如果继续优化，应保持 window/canonical-only 策略不变，只处理投影批内常数。

2026-05-21 复测：短普通文本 pending 跳过固定 prepare yield 后，最近窗口批次均为 `source=plain-text-fast-path`、`resolve≈0`、`yield=0`，`8 blocks` 批次稳定在约 `19.3–28.3ms`，尾批 `2 blocks≈13ms`。`prepare` 已降到常态 `1.2–2.6ms`，剩余主要成本转移到 `apply/locate/dispatch`：典型 `dispatch≈10–12ms`，`apply/locate≈7–11ms`。这说明 pending projection 的 Markdown runtime 与固定调度等待已经收口，下一步若继续优化，只应研究 `megaTr` 应用阶段定位与 dispatch 常数，不能回退到全量投影或扩大 hydrate 窗口。

同日继续复测：`megaTr` 应用阶段复用 prepare 阶段的 rootBlock 初始位置，并通过 transaction mapping 校验当前位置后，最近窗口批次 `locate=0`，`apply≈1.4–1.5ms`，8-block 批次降到 `13.4–14.6ms`，尾批 `2 blocks≈12.1ms`；剩余主导项是 `dispatch≈10–11ms`。这表示阶段 3 pending 入屏投影的高杠杆常数项已经收掉，后续不应为了继续压数字而扩大架构面，除非出现新的体感卡顿证据。

如果以上场景稳定，阶段 3 才能进入“清理旧 `BlockChrome` 路径 / 小文档是否统一 Host”的讨论；否则继续在当前 surface 的 read-model / orchestration 边界内修复，不扩大 Host 职责。

### 7.6 收口后续执行顺序

1. **补齐回归样本**：先跑 1500 pending + history + annotation，再跑 5000/10000 open + scroll 外推。此阶段只记录事实，不继续扩大 Host surface。
2. **清理临时观测**：迁移期为了定位问题加入的默认控制台日志必须删除或降级；保留 `window.__*_PERF__` 这类显式查询入口。
3. **评估旧路径清理**：确认大文档 Host 路径稳定后，再讨论旧 `<BlockChrome>` 在虚拟化路径中的残留是否可以删除；小文档旧路径是否统一 Host 需要单独评估，不和大文档收口混在一起。
4. **再谈 selector 深化**：如果回归显示某个 surface 仍有全局响应或明显耗时，再对该 feature 的 read-model / selector 做专项优化；没有证据时不预先重构。

### 7.7 风险登记

| 风险 | 等级 | 应对 |
|------|------|------|
| Teleport 大量 chrome 仍走 Tiptap `#5031` 风险路径 | 中 | host 直接挂在 `EditorContent` 下，**不通过 Tiptap vueRenderers 集合**；Teleport target 是 registry 暴露的原生 DOM anchor，不是 Tiptap 内部 DOM |
| 块 chrome 闪烁（active 集合频繁变化） | 中 | sticky activation（已有），延迟 deactivate 100–360ms |
| selector 内部仍然全局响应 | 高 | 每个 selector 必须有 benchmark：`update count per blockId per second` 必须 ≤ 1 |
| annotation panel 跨虚拟化边界定位错乱 | 中 | 当前只迁挂载权，不改定位算法；后续若优化定位，必须先通过 Annotation read-model / orchestration 暴露窄能力 |

### 7.8 退出条件

- `__BLOCK_ACTIVATION_PERF__` 显示 active chrome 数稳态 ≤ 20。
- `__VUE_NODEVIEW_PERF__` 活跃 Vue 实例数 = active chrome 数 + 极少壳层（阶段 2 也已经≈0）。
- selection 跨 100 块时，BlockChrome mount/unmount 总次数 ≤ 50（不是 200）。
- 拖拽、菜单、批注三类交互手感不劣化（必要时增加 sticky 时长）。

### 7.9 阶段 2/3 完成记录与维护边界

阶段 2/3 的主线已经完成：大文档路径不再回到每块 Vue NodeView，BlockChrome 通过 Host 按需挂载，pending 入屏投影保持 canonical-only + hydrated window 小批量策略。后续维护目标不是继续“演进架构”，而是守住现有体验、边界和测试门禁。

已完成的稳定规则：

- 热路径日志 lazy 化：engine 与 pending bridge 在 debug flag 关闭时不预构造 metrics。
- pending bridge 调度 typed reason 化：调度策略不再依赖日志 label 字符串匹配。
- render virtualization meta 失败显式化：内部 meta schema 错误不能静默吞掉整批 hydrate/dehydrate。
- scroll-handshake 临时租约可取消：重复交互刷新同一 `scroll-handshake` 租约，不叠加泄漏。
- keep-alive lease release 稳定化：release 不依赖已经 detached 的 Teleport 子树冒泡。
- BlockChromeHost surface target 解析下沉：DOM target 解析集中在纯函数，Host 不散落多套 computed。
- 旧小文档路径收口：`BlockChrome.vue` 和 `BlockView.vue` 的历史恢复、DOM 同步、生命周期、runtime handle、post-mount 队列、typed provide/inject 已下沉到窄 composable，并补充对应单元测试。

已完成的边界与门禁收口：

- 滚动热路径 rootBlock 顺序缓存：`EditorState.doc` identity 未变化时复用 rootBlock 顺序，滚动刷新不再每帧 `doc.descendants` 全文遍历。
- render window metrics 懒构造：DOM anchor / DOM sample 能决定窗口时不重建全量 metrics，只在 height-cache fallback 时构造。
- projection queue 卸载失效保护：bridge cleanup 后，仍在飞行中的 pending 投影完成时不能再触发 rerun 调度。
- mode 解析安全默认值：plugin state 未注册或未 ready 时保持 hydrated，只有 plugin 明确启用且当前块没有 hydrated 事实时才进入 placeholder。
- RenderVirtualization public/internal 出口第一刀：root `index.ts` 只暴露 engine snapshot、handshake、keep-alive 租约、runtime 只读查询和 transaction 观察窄口；plugin key、plugin state、registry 写能力、NodeView factory 和 height cache 写能力收进 `internal.ts`。
- 业务层 internal import 静态门禁：普通 editor 业务模块不能 import `RenderVirtualization/internal`，TableBlock 这类协作方只能通过 `hasRenderVirtualizationTransactionMeta(...)` 等 public contract 观察事务。
- Host keep-alive chrome 来源收窄：`BlockChromeHost` 不再直接读取 plugin state，而是从 engine snapshot 的 `pinnedBlockIds` 观察已提交的 keep-alive 事实。
- 虚拟化运行态 editor-scoped 第一刀：`RootBlock.addNodeView`、`RenderVirtualizationEngine`、`virtualEventKeepAlive`、`BlockChromeHost`、Revision overlay / shell header 和压测注入路径都改为按当前 editor owner 读取 / 写入运行态；owner 读取不再回退全局 active，无 owner API 只保留 legacy / DevTools 路径。已补 `editorFeatureFlags.runtime.test`、RootBlock owner mode 单测和 Engine 多 editor runtime 隔离单测。
- ShellPendingProjectionBridge 迁层：pending projection bridge、queue、调度策略、候选筛选和 perf ring buffer 已迁到 `features/Revision/orchestration/shellPendingProjection/`；`EditorContext` 只通过 Revision public export 安装 / 卸载桥接，UI composable 层不再承载跨 feature 投影规则。已补真实 RevisionStore 集成测试与 bridge cleanup / rerun 门禁。
- EditorContext runtime wiring 收口：`ui/runtime/setupEditorVirtualizationRuntime.ts` 统一创建 `BlockVisibilityManager`、`RenderVirtualizationEngine`、Shell visibility bridge 和 Revision pending projection bridge，并集中维护 ready / scroll-root-ready / cleanup 顺序。`EditorContext.vue` 只传入 editor 与 scrollRoot 生命周期，并通过返回的窄对象 provide engine / visibility 能力。已补 runtime wiring 单测，覆盖 eventBus 未 ready、重复安装、scroll-root-ready 和 cleanup 幂等。
- 旧 RootBlockShellView 生命周期 owner 化：非虚拟化 shell 压测路径也从 `RootBlock.addNodeView` 接收当前 editor owner，不再默认写入无 owner NodeView lifecycle 表。
- legacy owner 边界静态门禁：`legacyOwnerBoundary.static-guard.test.ts` 禁止生产路径新增无 owner runtime registry、runtime public read port、NodeView lifecycle 和 height cache 调用；legacy fallback 只允许保留在实现文件和测试里。
- KeepAlivePort / public API 收窄第二刀：root `index.ts` 不再导出 raw DOM keep-alive event，只保留 `KeepAlivePort`、注入 key、Vue lease、语义化 command helper 和 NodeView / position 窄入口。AiWriting、Annotation、旧 BlockChrome、Table UI、SlashMenu 和 TableColumnResize 已迁到 command helper；Vue 入口优先注入 owner-scoped port，DOM event 只作为 helper 内部 legacy adapter。`renderVirtualizationImportBoundary.static-guard.test.ts` 已补门禁，阻止普通业务模块重新直接 import `keepAliveEvents`。
- Host target / scrollHandshake 多 editor 门禁：相同 blockId 在不同 editor 中不能互相复用 Host Teleport target，也不能互相唤醒 hydrate handshake waiter；owner cleanup 不能清掉另一个 editor 的 runtime target。
- app wiring cleanup 收口：`setupEditorVirtualizationRuntime.cleanup()` 会复位当前 editor owner 的 shell runtime state，避免组件卸载后旧 editor 对象仍被判断为 virtual active。

条件触发维护项：

长期事实源回到本路线图、`RenderVirtualization/README.md`、`blockChromeHost/README.md`、`integration/README.md` 和性能基线。下面这些项不是当前阶段的主动架构演进任务；只有出现新的产品需求、性能证据或回归风险时，才按表格里的门禁单独启动。不要为了“继续演进”而主动重写已经稳定的滚动、pending 投影和 Host chrome 路径。

| 观察项 | 当前状态 | 重新启动前必须满足 |
|--------|----------|--------------------|
| 虚拟化运行态继续收到 plugin/editor storage | owner-scoped runtime 第一刀已完成；owner 读取已禁止回退全局 active；runtime registry / NodeView lifecycle / height cache 的生产 API 已不再提供 ownerless fallback。仍保留无 owner DevTools 运行态和 `editorFeatureFlags` 模块级状态，完全收进 plugin/editor storage 会触碰 app wiring 与旧焦点策略 | direct-state 1500/5000/10000 回归、旧文件加载回归、初始焦点策略 owner 化设计 |
| 多 editor 端到端隔离继续加固 | runtime registry / nodeViewLifecycle / height cache owner 化已完成；RootBlockShellView 旧 shell path 已接入 owner lifecycle；legacy owner 静态门禁、Host target 同名 blockId 门禁和 scrollHandshake 同名 blockId 门禁已补；legacy 表只剩显式测试 adapter | 文档切换 / app wiring 级别手测；未来若继续删除测试 adapter，需要先补真实双 editor UI harness |
| RenderVirtualization public/internal 出口继续收窄 | 第二刀已完成：raw DOM keep-alive event 已从 public root 移除；普通业务模块不能 import `internal.ts` 或 `keepAliveEvents`。仍有 app wiring / 压测诊断使用 `internal.ts`，未来要继续把可稳定公开的能力沉淀成更窄 contract | 保持 import boundary 静态门禁，新增 public contract 必须有单测和 README 说明 |
| EditorContext runtime wiring 继续收口到更高层 | editor 级虚拟化 runtime setup 已完成，并在 cleanup 时复位 owner runtime；但 EditorContext 仍负责批注布局、保存钩子、全局事件等其他职责，后续若继续减薄组件，应另开非虚拟化专项 | EditorContext 组件集成测试、文件切换 / 卸载保存回归、pending 10000 手测 |
| owner-scoped KeepAlivePort 替代 DOM event 主协议 | 第二刀已完成：Vue 入口优先注入 port，旧 BlockChrome / AiWriting / Annotation / Table UI / SlashMenu / TableColumnResize 不再直接派发 raw event；DOM event 只作为 command helper 内部 legacy adapter。scrollHandshake 已支持显式 port，仍保留 action-time DOM fast-path | Vue / 非 Vue 两类租约、detached target release、reason 合并、engine 多实例隔离测试已覆盖；仍需表格 / 代码块专项手测 |
| viewportTracker 显式状态机重写 | 当前滚动条跟手机制刚稳定，重写算法风险高 | 已覆盖 scrollbar drag、cleanup、blur、correction echo、unchanged scroll；仍需补 wheel、touchpad、jump 状态转移测试 |
| scrollHandshake 事实源收敛 | 第一刀已完成：临时 `scroll-handshake` 租约支持显式 KeepAlivePort；DOM fast-path、runtime await、hydrate 判断顺序保持不变 | 隐藏块 hydrate、已 hydrated 点击、hydrate timeout、重复交互 timer、port 临时租约测试已覆盖；文档切换专项继续保留 |
| committer API 强制 editor 必传 / 去掉 fallback dispatch | 第一刀已完成：生产 commit API 已强制 editor owner，view-only dispatch 仅保留为测试 adapter；keydown 预水合也已迁 editor 契约 | 全调用方梳理和 committer 单测已补；仍需 direct-state 1500/5000/10000 手测回归 |
| RootBlock DOM contract 统一 | 第一刀已完成：RootBlock class/data/style/mount target 已收口到 editor shared contract；后续改 DOM 结构必须先改 contract 和测试 | DOM contract 快照测试、旧/新路径 mount target 对齐测试已补，后续继续防止新硬编码 selector |

阶段 2/3 后续代码质量整理必须遵守：

- 不为了“代码更干净”改坏滚动条跟手、pending 入屏投影、Host chrome 体验。
- 不把结构性改造塞进小修复；每次只动一个事实源或一个边界。
- 每次整理都先补或更新单元测试，再跑 1500 / 5000 / 10000 的必要手测样本。

### 7.10 条件触发变更协议

下面这些方向仍然有研究价值，但它们不是当前主动维护任务。任何一项要重新启动，都必须先把当前体验作为门禁跑过一遍，再写设计，不允许先改代码再解释。

当前体验门禁：

| 门禁 | 必须保持的体验 | 自动 / 手动证据 |
|------|----------------|-----------------|
| 真实文档加载 | 文件切换和加载不能出现 Vue `instance.update is not a function`、unmount 空实例、旧 BlockChrome setup 顺序错误 | `setupEditorVirtualizationRuntime.test.js` + 真实文档切换手测 |
| 原生滚动条拖拽 | 5000 / 10000 按住滚动条反复上下时，thumb 不再逐渐脱离鼠标 | `viewportTracker.test.ts` 的 repeated drag 门禁 + 30 秒手动拖拽 |
| 滚动内容补齐 | 拖拽期间允许内容暂缓，松手后必须 settled correction 补齐当前窗口 | `viewportTracker.test.ts` + `auto.scroll()` summary |
| pending 入屏 | 10000 pending 首开保持 canonical-only，header 只按 hydrated window 小批量投影，不恢复首开全量 `revisionMark` | `pendingProjection.integration.test.ts` + `__REVISION_TEST__.seed(10000)` 手测 |
| Host chrome | left handle / annotation / revision / history 只挂当前 editor owner 的 runtime target，不能跨 editor 复用同名 blockId | `renderVirtualization.integration.test.ts` + `resolveBlockChromeHostSurfaceTargets.test.ts` |
| public/internal 边界 | 普通业务模块不能 import `RenderVirtualization/internal`，新增 public contract 必须窄且可测试 | `renderVirtualizationImportBoundary.static-guard.test.ts` |

未来条件触发项：

1. **legacy fallback 最终退场**：生产 API 已经不再提供 ownerless fallback；剩余 legacy 表只通过测试 adapter 显式访问。后续如果继续删除测试 adapter，需要先补真实双 editor UI harness。
2. **runtime 完整进入 plugin/editor storage**：先证明 owner-scoped runtime 已经覆盖所有生产入口，再设计从 `editorFeatureFlags` 模块级状态迁移的路径。
3. **viewportTracker 状态机化**：必须以当前拖拽手感为验收标准；如果状态机重写让 thumb 再次慢一拍或回弹，就必须回退。
4. **public/internal API 继续收窄**：raw keep-alive event 已退出 public root；后续只能在已有业务调用沉淀出稳定 contract 后继续收窄，不能为了隐藏文件而制造新的胶水。
5. **KeepAlivePort 完全替代 DOM event 旧路径**：业务入口已迁到 port-first command helper；下一步只在确认所有非 Vue 入口都能拿到 owner-scoped port 后，再考虑删除 DOM event adapter。

---

## 8. 阶段 4：浏览/编辑双模式 POC

> 状态：条件触发。**仅在阶段 1+2+3 完成后未达成性能目标时启动**。
>
> 风险等级：高。架构级别改动。
>
> 预计周期：6–8 周 POC + 视结果决定是否产品化。

### 8.1 触发条件

只有当以下条件**全部满足**时才启动：

1. 阶段 1+2+3 全部退出条件达成。
2. 在 10000 块场景下 p95 滚动帧时间仍 > 25ms，或当前块输入 → next paint 仍 > 80ms。
3. 业务侧确认目标用户文档分布的 P95 已经达到 5000+ 块（参见 `analysis` 第 11 节产品规模估计）。
4. 团队评估认为阶段 5 的换底层风险更高、收益不更优。

**如果只有 1 和 2 满足、3 不满足，应该回到产品定义层，而不是启动阶段 4。**

### 8.2 POC 范围

参考 `analysis` 第 8 节的最小验证范围：

- 同一份 10000 rootBlock 数据。
- 浏览模式：轻量静态块渲染，无 ProseMirror View，无 BlockChrome。
- 编辑模式：点击某块后局部挂载 ProseMirror（"编辑岛"）。
- 编辑完成写回 canonical doc。

POC **不验证**的范围：

- 完整表格、跨块拖选、全文 undo、AI 写入、多块拖拽。

### 8.3 关键设计点（POC 阶段需回答）

1. **浏览态 selection**：用什么实现？原生 DOM Range 还是自研选区？
2. **编辑岛边界**：单块编辑岛，还是 section 级编辑岛？
3. **批注锚点**：阶段 2 的 registry 是否足够？还是需要 canonical-level annotation anchor？
4. **AI 写入跨边界**：流式插入跨多个非活跃块时怎么处理？
5. **键盘 PageDown / 方向键过渡**：从浏览态进入编辑态时怎么处理 selection 平滑过渡？

### 8.4 决策点 2

POC 完成后，团队评审：

- 浏览态滚动是否达到原生 DOM 水准？
- 浏览态进入编辑态的延迟是否 ≤ 100ms？
- 跨边界交互（复制、批注、AI）是否能复用阶段 2 的 registry 协议？

**值得**：进入产品化，预计还需要 3–6 个月集成现有 feature。

**不值得**：保留 POC 代码作为参考，路线收束于阶段 1+2+3 + 产品规模上限定义。

---

## 9. 阶段间决策点

### 9.1 决策点 1（阶段 1+2+3 完成后）

性能验收口径（10000 块文档）：

| 指标 | 阶段 1 后目标 | 阶段 2 后目标 | 阶段 3 后目标 |
|------|--------------|---------------|---------------|
| 首开（first hydrated window ready） | < 3000ms | < 1500ms | < 1500ms |
| 滚动 p95 帧时间 | < 30ms | < 20ms | < 16ms |
| 当前块输入 → next paint p95 | < 80ms | < 50ms | < 30ms |
| selectionUpdate 回调总次数 / 一次选区变化 | < 100 | < 20 | ≤ 当前 active chrome 数 |
| 拖拽 dragover 单次耗时 p95 | < 4ms | < 4ms | < 4ms |
| 活跃 Vue 组件实例数（不含必要 host） | < 480 | < 30 | < 20 |

**全部达成** → 路线收束，转入维护和上游跟踪（阶段 5）。

**任意核心指标未达成** → 进入阶段 4 决策。

### 9.2 决策点 2（阶段 4 POC 完成后）

见 8.4。

---

## 10. 风险登记

### 10.1 路线级风险

| 风险 | 等级 | 影响阶段 | 应对 |
|------|------|---------|------|
| Tiptap 未来版本破坏性更新影响 registry / nodeView 集成 | 中 | 阶段 2 后 | 阶段 0 baseline 文档锁定 Tiptap 版本；升级 Tiptap 必须跑全部 benchmark |
| Vue 3.6 Vapor 稳定后接入路径破坏现有 chrome | 低 | 阶段 5 | 见 11.1，仅 watch-only |
| Vapor 永远不稳定 / 推迟 | 低 | 阶段 5 | 不影响主路线，因为主路线不依赖 Vapor |
| 阶段 2 改造过程中线上稳定性受影响 | 高 | 阶段 2 | 不新增长期 flag；通过小 PR、完整 benchmark、现有 1500 阈值运行态和快速回滚控制风险 |
| 团队对"产品规模目标"理解不一致导致路线动摇 | 高 | 全程 | `analysis` 第 11 节产品规模假设需要业务侧签字确认；本路线图与 analysis 文档绑定 |

### 10.2 技术债登记

阶段 2/3 落地后会产生一些过渡状态的技术债，**必须在阶段 2/3 完成后 1 个月内清理**：

1. 旧 `BlockView.vue` 代码删除（或保留为 `LegacyBlockView` 仅作回退兜底，6 个月后删）。
2. `RootBlockShellView.js` 是否仍保留：如果裸 DOM NodeView 已覆盖所有路径，且不再做"非虚拟化压测"，可以删；否则保留并明确"仅压测路径"。
3. 大量 `inject/provide` 改成 registry 后，未使用的 injection key 清理。
4. `useBlockVisibilityManager` 是否仍需要：registry 是否已经接管它的角色。

---

## 11. 长期观察（阶段 5：现在不做，但持续跟踪）

### 11.1 Vue 3.6 Vapor Mode

跟踪项：

- 稳定版发布时间（当前 2026-04 beta.10）。
- Tiptap 是否官方支持 Vapor 组件作为 NodeView。
- 主流编辑器（Notion 类 Vue 实现）是否率先迁移。

接入策略（稳定后）：

- **不全局迁移**。只在 `BlockChrome` 这类高频组件试点。
- 试点前必须跑阶段 0 的 5 个 benchmark 对比。
- 即使 Vapor 接入成功，**也不撤销阶段 2 的裸 DOM NodeView**——这是两个独立的优化方向。

### 11.2 Tiptap 上游修复跟踪

跟踪项：

- `tiptap#5031`（已 closed，2024-07）：观察是否回归。
- `tiptap#6440`（mid-2025 仍 open）：等待最终方案。
- `tiptap#6946`（已合入 v3.4.3）：`markViews & nodeViews` 优化是否对我们有额外收益。

策略：

- 升级 Tiptap 主版本必须跑 baseline。
- 如果上游修复了核心 `VueNodeViewRenderer` 性能问题，**阶段 2 的裸 DOM NodeView 也不撤销**——架构解耦本身是更长期的价值。

### 11.3 Lexical / 裸 ProseMirror / 自研

- **暂不投入实验**。
- 仅在阶段 4 双模式 POC 后仍无法达成产品目标时考虑。
- 投入门槛：6 人月以上专项。

### 11.4 CodeMirror 6 路线

- 如果产品方向转向"Markdown IDE"而非"块级富文本知识文档"，重新评估。
- 不主动驱动。

---

## 12. 文档维护规则

### 12.1 何时更新本文档

- 每个阶段进入 / 退出时：更新该阶段状态。
- 决策点 1/2 触发时：记录决策结果。
- 风险登记新增 / 关闭时：同步更新第 10 节。
- 上游（Tiptap / Vue）出现影响路线的变化时：更新第 11 节。

### 12.2 何时新建关联文档

- 阶段 0 完成时：新建 `perf-baseline-2026-Q2.md` 锁定基线数据。
- 阶段 2 完成时：更新 `features/RenderVirtualization/README.md` 反映新的 NodeView 形态。
- 阶段 3 完成时：更新 `features/RenderVirtualization/README.md` 的 keep-alive / chrome 章节，并在 `perf-baseline-2026-Q2.md` 记录回归数据。
- 阶段 4 启动时：新建 `browse-edit-dual-mode-design.md`。

### 12.3 本文档与实现 / 基线文档的关系

- `features/RenderVirtualization/README.md` 是当前实现总览，应保持与代码事实同步。
- `perf-baseline-2026-Q2.md` 是性能证据记录，应保存关键压测数据、异常和回归结论。
- 本文档（roadmap）是"行动计划"，只保留当前认可的最终路径和阶段。
- 当实现总览或性能基线出现会影响路线的事实时，本文档需要评审并刷新阶段定义。
- 当本文档阶段切换时，同步更新实现总览与性能基线，避免路线、代码事实和压测证据分叉。

---

## 13. 一句话总结

> 阶段 2/3 已完成：大文档主路径是裸 DOM RootBlock NodeView + BlockChromeHost + owner-scoped runtime / KeepAlivePort。后续只做稳定维护和证据触发的条件变更，不主动重写已经稳定的滚动、pending 投影和 Host chrome 路径。

---

## 附：阶段进度跟踪表（执行时填写）

| 阶段 | 状态 | 启动日期 | 退出日期 | benchmark 链接 | 负责人 | 备注 |
|------|------|---------|---------|---------------|--------|------|
| 阶段 0 | 已完成首轮 | 2026-05-19 | — | `docs/perf-baseline-2026-Q2.md` | — | 已记录 500 / 1500 / 5000 / 10000 open/menu/annotation/scroll compact summary；selection / 输入 / 拖拽专项继续补 |
| 阶段 1 | 阶段性完成 | 2026-05-19 | 2026-05-20 | `docs/perf-baseline-2026-Q2.md` | — | 解决 outline presence 卡死、滚动高度缓存塌陷和普通滚动测高；5000 拖动仍不跟手，进入阶段 2 |
| 阶段 2 | 已完成，稳定维护 | 2026-05-20 | 2026-05-22 | `docs/perf-baseline-2026-Q2.md` | — | 裸 DOM `RootBlockDomNodeView` 已成为大文档 hydrated 主路径；runtime registry / nodeViewLifecycle / height cache 已完成 owner-scoped 边界，并通过 legacy owner 静态门禁防止生产路径回退到无 owner 表 |
| 阶段 3 | 已完成，稳定维护 | 2026-05-20 | 2026-05-22 | `docs/perf-baseline-2026-Q2.md` | — | Host 已接管 left-handle、annotation-handle、annotation-panel 挂载层、revision-indicator、revision-toolbar、history-panel；pending 10000 入屏批次已从秒级收敛到约 13–15ms 稳态。后续只做回归门禁维护，不继续扩大 Host 职责 |
| 阶段 4 | 条件触发 | — | — | — | — | 触发条件未满足前不填写 |
| 阶段 5 | 持续跟踪 | — | — | — | — | 仅做 upstream watch |
