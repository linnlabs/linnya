# Editor 虚拟化性能基线 2026 Q2

> 状态：执行中。
>
> 目的：记录阶段 1 优化后的真实前端交互基线，决定下一步是继续 `shallowRef / markRaw` 收割，还是进入 `RootBlockRuntimeRegistry` 铺路。

---

## 0. 先看这里：真正执行入口

这份文档里，第 1-3 章是背景和 API 说明，真正执行测试时不要从头照读。

实际顺序是：

1. 先按第 2 章准备环境；
2. 再按第 4 章跑通用流程；
3. 具体动作按第 5 章选择；
4. 结果写回第 7 章。

特别注意：`10000 rootBlock` 的完整滚动不再建议人工从顶部滚到底部。这个动作太长，会把“人滚动用了多久”混进性能数据。标准滚动基线用自动脚本，人工滚动只做 30 秒体感抽样。

当前自动化边界：

- 已自动化：首开 / 注入、标准滚动、块操作菜单打开、批注创建、渲染虚拟化探针采样；
- 暂不自动化：真实拖拽，因为它最依赖鼠标命中、拖拽反馈和主观跟手感；
- 这套工具是开发环境激进压测：会覆盖当前编辑器内容，会清空当前 annotationStore，会创建批注，并可能触发真实自动保存。跑之前默认当前文档就是压测沙袋。

---

## 1. 测试原则

这轮测试不是自动化单元测试，而是**人工操作 + DevTools 脚本采样**。

原因很简单：滚动、拖拽、菜单、批注这些卡顿主要发生在真实 Chromium 渲染、布局、命中测试和主线程调度里，纯 Node 测试测不到。脚本只负责：

- 生成指定规模文档；
- 标记一次人工操作的开始和结束；
- 抓取所有 `window.__*_PERF__` 探针快照；
- 对 10000 级长文档提供标准化自动滚动；
- 导出一份 JSON 报告，方便贴回本文档。

人工负责：

- 真实输入；
- 真实跨块 selection；
- 真实拖拽；
- 真实拖拽过程里的菜单 / 批注跟手感观察。

---

## 2. 环境准备

### 2.1 启动前

1. 关闭其它高占用应用。
2. 关闭 Electron DevTools 里多余的面板，只保留 Console。
3. 关闭前端热更新之外的重任务，例如大批量后台索引。
4. 每一档测试前刷新 / 重新打开一次编辑器页面，避免上一次 DOM / store 残留影响结果。

### 2.2 文档规模

每项至少跑四档：

```text
500 rootBlock
1500 rootBlock
5000 rootBlock
10000 rootBlock
```

建议每档跑 3 次，记录 median 和最差值。第一轮可以先只跑 10000，确认脚本链路没问题。

---

## 3. 控制台 API

打开编辑器页面后，在 DevTools Console 使用：

```js
window.__EDITOR_PERF_BENCH__
```

核心 API：

```js
// 生成并注入指定块数文档
window.__EDITOR_PERF_BENCH__.run(10000)

// 默认 loadMode='auto'：复用产品真实路径。
// 1500+ rootBlock 会走 direct-state + RenderVirtualization 初始化。
window.__EDITOR_PERF_BENCH__.run(10000, { loadMode: 'auto' })

// 只在对比旧路径时使用：全量 setContent / Vue NodeView 路径。
window.__EDITOR_PERF_BENCH__.run(10000, { loadMode: 'command' })

// 查看当前所有关键探针快照
window.__EDITOR_PERF_BENCH__.snapshot()

// 开始一次人工测试 session
window.__EDITOR_PERF_BENCH__.manual.start({
  label: '10000-scroll-run-1',
  blockCount: 10000,
  scenario: 'scroll',
  notes: '从顶部连续滚到底部'
})

// 开始记录一个人工动作
window.__EDITOR_PERF_BENCH__.manual.startOp('scroll-top-to-bottom')

// 结束当前动作
window.__EDITOR_PERF_BENCH__.manual.endOp()

// 结束 session，返回完整 JSON 报告
const report = window.__EDITOR_PERF_BENCH__.manual.finish()

// 复制 JSON 到剪贴板，同时返回字符串
window.__EDITOR_PERF_BENCH__.manual.copy(report)

// 标准化自动滚动：自动开始 session、滚动、结束并返回报告
const autoReport = await window.__EDITOR_PERF_BENCH__.auto.scroll({
  label: '10000-scroll-auto-run-1',
  blockCount: 10000,
  stepPx: 1600
})
window.__EDITOR_PERF_BENCH__.manual.copy(autoReport)

// 多规模自动套件：500 / 1500 / 5000 / 10000 依次跑 open、menu、annotation、scroll
const reports = await window.__EDITOR_PERF_BENCH__.auto.scaleSuite({
  scenarios: ['open', 'menu', 'annotation', 'scroll']
})
const readSnapshot = (report) => report.finalSnapshot ?? report
const summary = reports.map((report) => {
  const snapshot = readSnapshot(report)
  const viewportHistory = report.histories?.viewportTracker ?? []
  const lastViewportEvent = viewportHistory[viewportHistory.length - 1] ?? snapshot.viewportTracker
  return {
    label: report.label,
    blockCount: report.blockCount,
    durationMs: Math.round(report.durationMs * 10) / 10,
    operationMs: Math.round((report.operations?.[0]?.durationMs ?? 0) * 10) / 10,
    setContentMs: snapshot.openPerf?.timings?.setContentMs ?? null,
    viewUpdateMs: snapshot.openPerf?.timings?.setContentViewUpdateMs ?? null,
    nonViewMs: snapshot.openPerf?.timings?.setContentNonViewUpdateMs ?? null,
    rootBlocks: snapshot.openPerf?.docInfo?.rootBlockCount ?? null,
    nodeViews: snapshot.nodeView?.activeTotal ?? null,
    vueNodeViews: snapshot.nodeView?.activeByKind?.vue ?? null,
    domBlocks: snapshot.virtualizationDiag?.dom?.rootBlockDomCount ?? null,
    hydratedDom: snapshot.virtualizationDiag?.dom?.hydratedDomCount ?? null,
    placeholderDom: snapshot.virtualizationDiag?.dom?.placeholderDomCount ?? null,
    virt: snapshot.virtualizationDiag?.virtualizationEnabled ?? null,
    chromeActive: snapshot.blockChrome?.activation?.activeCount ?? null,
    scrollHeight: snapshot.scroll?.scrollHeight ?? null,
    maxScrollTop: snapshot.scroll?.maxScrollTop ?? null,
    adaptiveHeight: snapshot.heightCache?.adaptiveElementHeight ?? null,
    measuredHeights: snapshot.heightCache?.measuredCount ?? null,
    viewportEvents: viewportHistory.length,
    lastViewportDecision: lastViewportEvent?.decision ?? null,
  }
})
console.table(summary)
copy(JSON.stringify({ reports, summary }, null, 2))
```

注意：

- `manual.start()` 会清理滚动、拖拽、decoration 这类纯历史探针；不会清理 NodeView / BlockChrome active 集合，因为那些 active 集合代表当前真实挂载状态，清掉会让数据失真。
- `manual.copy(report)` 会尝试写入剪贴板；如果 DevTools 当前没有页面焦点，浏览器可能拒绝剪贴板写入。此时控制台返回值仍然是完整 JSON 字符串，可以直接复制返回值。
- 默认自动套件必须命中真实虚拟化路径。1500 / 5000 / 10000 档如果出现 `virtualizationEnabled=false`、`placeholderDomCount=0`、`hydratedDomCount=docRootBlockCount`，说明测到的是旧 `command` 路径，不能拿来评价虚拟化效果。
- 压测文档每轮会生成不同的合法 `root-*` block id。不要手动复用上一轮 id，否则 ProseMirror 可能复用旧 NodeView，把 500 档的非虚拟化 DOM 带进 1500+ 虚拟化测试。

---

## 4. 通用执行流程（从这里开始照做）

每一档文档都按这个顺序来：

### Step 1：生成文档

```js
window.__EDITOR_PERF_BENCH__.run(10000)
```

等页面稳定 3 秒，然后执行：

```js
window.__EDITOR_PERF_BENCH__.snapshot()
```

检查重点：

- `virtualizationDiag.docRootBlockCount` 是否等于目标数量；
- `virtualizationDiag.virtualizationEnabled`：1500 / 5000 / 10000 应为 `true`；
- `virtualizationDiag.dom.placeholderDomCount`：大文档应接近 `docRootBlockCount - hydratedDomCount`；
- `nodeView.activeByKind.vue` 是否大致在 100-200 级；
- `blockChrome.editorListeners.total` 是否接近 2，而不是 `BlockChrome × 2`。

### Step 2：开始对应场景 session

例如滚动：

```js
window.__EDITOR_PERF_BENCH__.manual.start({
  label: '10000-scroll-run-1',
  blockCount: 10000,
  scenario: 'scroll'
})
```

### Step 3：开始动作

```js
window.__EDITOR_PERF_BENCH__.manual.startOp('scroll-top-to-bottom')
```

### Step 4：在前端执行动作

按下面第 5 节的动作说明操作。滚动场景优先使用自动滚动脚本，输入、selection、拖拽仍然需要真实人工操作。

### Step 5：结束动作

```js
window.__EDITOR_PERF_BENCH__.manual.endOp()
```

### Step 6：结束并导出

```js
const report = window.__EDITOR_PERF_BENCH__.manual.finish()
window.__EDITOR_PERF_BENCH__.manual.copy(report)
```

把 JSON 粘到本文档第 8 节对应位置，或另存为本地临时文件。

---

## 5. 动作脚本与人工抽样

### 5.1 首开 / 注入

动作：

1. 刷新页面。
2. 打开 Console。
3. 执行：

```js
window.__EDITOR_PERF_BENCH__.manual.start({
  label: '10000-open-run-1',
  blockCount: 10000,
  scenario: 'open'
})
window.__EDITOR_PERF_BENCH__.run(10000)
const report = window.__EDITOR_PERF_BENCH__.manual.finish()
window.__EDITOR_PERF_BENCH__.manual.copy(report)
```

等价自动脚本：

```js
const report = await window.__EDITOR_PERF_BENCH__.auto.open({
  label: '10000-open-auto-run-1',
  blockCount: 10000
})
window.__EDITOR_PERF_BENCH__.manual.copy(report)
```

记录重点：

- `finalSnapshot.openPerf.timings.setContentMs`
- `finalSnapshot.openPerf.timings.setContentViewUpdateMs`
- `finalSnapshot.openPerf.nodeViewStats`
- `finalSnapshot.nodeView`
- `finalSnapshot.blockChrome.lifecycleActiveCount`

### 5.2 滚动

标准动作：

1. 光标放在文档顶部附近。
2. 执行：

```js
const report = await window.__EDITOR_PERF_BENCH__.auto.scroll({
  label: '10000-scroll-auto-run-1',
  blockCount: 10000,
  stepPx: 1600,
  notes: '标准自动滚动：顶部到底部'
})
window.__EDITOR_PERF_BENCH__.manual.copy(report)
```

人工体感抽样：

1. 只做 30 秒，不要求滚到底；
2. 用触控板 / 鼠标滚轮在同一段区域自然滚动；
3. 记录主观体感：是否掉帧、是否有明显“粘住”、菜单 / 批注是否跟手。

如果确实要记录人工滚动片段，使用：

```js
window.__EDITOR_PERF_BENCH__.manual.start({
  label: '10000-scroll-manual-30s-run-1',
  blockCount: 10000,
  scenario: 'scroll',
  notes: '人工自然滚动 30 秒，不要求滚到底'
})
window.__EDITOR_PERF_BENCH__.manual.startOp('wheel-scroll-30s')

// 手动滚动 30 秒后再执行：
window.__EDITOR_PERF_BENCH__.manual.endOp()
const report = window.__EDITOR_PERF_BENCH__.manual.finish()
window.__EDITOR_PERF_BENCH__.manual.copy(report)
```

记录重点：

- `histories.renderVirtualization.length`
- `histories.renderVirtualization[*].durationMs` 的最大值；
- `histories.renderVirtualization[*].hydratedCount`
- `histories.renderVirtualization[*].windowSelectionSource`
- `finalSnapshot.nodeView.activeByKind.vue`
- `finalSnapshot.blockChrome.lifecycleActiveCount`

### 5.3 块操作菜单打开

标准动作：

```js
const report = await window.__EDITOR_PERF_BENCH__.auto.menu({
  label: '10000-menu-auto-run-1',
  blockCount: 10000
})
window.__EDITOR_PERF_BENCH__.manual.copy(report)
```

记录重点：

- `histories.blockActionMenu[*].totalMs`
- `histories.blockActionMenu[*].itemsMs`
- `histories.blockActionMenu[*].itemCount`
- `finalSnapshot.blockChrome.editorListeners`

这个动作只打开菜单，不执行菜单项，因此是非破坏性测试。

### 5.4 批注创建

标准动作：

```js
const report = await window.__EDITOR_PERF_BENCH__.auto.annotation({
  label: '10000-annotation-auto-run-1',
  blockCount: 10000
})
window.__EDITOR_PERF_BENCH__.manual.copy(report)
```

记录重点：

- `histories.annotationInteraction[*].totalMs`
- `histories.annotationInteraction[*].triggerMs`
- `finalSnapshot.blockChrome.activation`
- `finalSnapshot.renderVirtualization`

这个动作会真实点击批注按钮，写入 annotationStore，并可能随自动保存写回当前开发文档。

### 5.5 当前块输入

动作：

1. 滚到文档中段。
2. 点击一个普通段落。
3. 执行：

```js
window.__EDITOR_PERF_BENCH__.manual.start({
  label: '10000-input-middle-run-1',
  blockCount: 10000,
  scenario: 'input',
  notes: '中段普通段落连续输入 30 个字符'
})
window.__EDITOR_PERF_BENCH__.manual.startOp('type-30-chars')
```

4. 在当前段落连续输入 30 个字符，中文输入法另跑一轮。
5. 执行：

```js
window.__EDITOR_PERF_BENCH__.manual.endOp()
const report = window.__EDITOR_PERF_BENCH__.manual.finish()
window.__EDITOR_PERF_BENCH__.manual.copy(report)
```

记录重点：

- 操作主观体感：是否丢字、卡顿、composition 卡住；
- `finalSnapshot.decoration.summary`
- `finalSnapshot.blockChrome.editorListeners`
- `histories.renderVirtualization` 是否在输入期间频繁刷新。

### 5.6 Selection 跨块移动

动作：

1. 滚到文档中段。
2. 点击一个段落，让光标进入块内。
3. 执行：

```js
window.__EDITOR_PERF_BENCH__.manual.start({
  label: '10000-selection-run-1',
  blockCount: 10000,
  scenario: 'selection',
  notes: '按方向键跨约 100 个块'
})
window.__EDITOR_PERF_BENCH__.manual.startOp('arrow-down-100-blocks')
```

4. 长按 ArrowDown 或重复按方向键，跨过约 100 个块。
5. 执行：

```js
window.__EDITOR_PERF_BENCH__.manual.endOp()
const report = window.__EDITOR_PERF_BENCH__.manual.finish()
window.__EDITOR_PERF_BENCH__.manual.copy(report)
```

记录重点：

- `finalSnapshot.blockChrome.editorListeners.total` 是否仍接近 2；
- `finalSnapshot.decoration.summary` 是否出现单次大耗时；
- 光标是否进入 placeholder 边界时卡住或丢失。

### 5.7 拖拽

动作：

1. 滚到文档顶部。
2. 选一个普通段落的左侧拖拽柄。
3. 执行：

```js
window.__EDITOR_PERF_BENCH__.manual.start({
  label: '10000-drag-run-1',
  blockCount: 10000,
  scenario: 'drag',
  notes: '从顶部拖一个块到中段附近'
})
window.__EDITOR_PERF_BENCH__.manual.startOp('drag-block-top-to-middle')
```

4. 鼠标按住拖拽柄，慢慢拖到中段，松手。
5. 执行：

```js
window.__EDITOR_PERF_BENCH__.manual.endOp()
const report = window.__EDITOR_PERF_BENCH__.manual.finish()
window.__EDITOR_PERF_BENCH__.manual.copy(report)
```

记录重点：

- `histories.dragOver[*].durationMs`
- `histories.dragOver[*].eventCount`
- `finalSnapshot.drag.lastDragAction`
- 拖拽指示线是否跟手、是否跳动。

### 5.8 多规模自动套件

如果要一次性跑 500 / 1500 / 5000 / 10000：

```js
const reports = await window.__EDITOR_PERF_BENCH__.auto.scaleSuite({
  blockCounts: [500, 1500, 5000, 10000],
  scenarios: ['open', 'menu', 'annotation', 'scroll'],
  scrollStepPx: 1600
})

const readSnapshot = (report) => report.finalSnapshot ?? report
const summary = reports.map((report) => {
  const snapshot = readSnapshot(report)
  const viewportHistory = report.histories?.viewportTracker ?? []
  const lastViewportEvent = viewportHistory[viewportHistory.length - 1] ?? snapshot.viewportTracker
  return {
    label: report.label,
    blockCount: report.blockCount,
    durationMs: Math.round(report.durationMs * 10) / 10,
    operationMs: Math.round((report.operations?.[0]?.durationMs ?? 0) * 10) / 10,
    setContentMs: snapshot.openPerf?.timings?.setContentMs ?? null,
    viewUpdateMs: snapshot.openPerf?.timings?.setContentViewUpdateMs ?? null,
    nonViewMs: snapshot.openPerf?.timings?.setContentNonViewUpdateMs ?? null,
    rootBlocks: snapshot.openPerf?.docInfo?.rootBlockCount ?? null,
    nodeViews: snapshot.nodeView?.activeTotal ?? null,
    vueNodeViews: snapshot.nodeView?.activeByKind?.vue ?? null,
    domBlocks: snapshot.virtualizationDiag?.dom?.rootBlockDomCount ?? null,
    hydratedDom: snapshot.virtualizationDiag?.dom?.hydratedDomCount ?? null,
    placeholderDom: snapshot.virtualizationDiag?.dom?.placeholderDomCount ?? null,
    virt: snapshot.virtualizationDiag?.virtualizationEnabled ?? null,
    chromeActive: snapshot.blockChrome?.activation?.activeCount ?? null,
    scrollHeight: snapshot.scroll?.scrollHeight ?? null,
    maxScrollTop: snapshot.scroll?.maxScrollTop ?? null,
    adaptiveHeight: snapshot.heightCache?.adaptiveElementHeight ?? null,
    measuredHeights: snapshot.heightCache?.measuredCount ?? null,
    viewportEvents: viewportHistory.length,
    lastViewportDecision: lastViewportEvent?.decision ?? null,
  }
})
console.table(summary)
copy(JSON.stringify({ reports, summary }, null, 2))
```

如果只想先跑开销较小的项：

```js
await window.__EDITOR_PERF_BENCH__.auto.scaleSuite({
  scenarios: ['open', 'menu', 'annotation']
})
```

如果只想跑滚动：

```js
await window.__EDITOR_PERF_BENCH__.auto.scaleSuite({
  scenarios: ['scroll'],
  scrollStepPx: 1600
})
```

如果要专门看 5000 / 10000 滚动条拖拽为什么不跟手，优先看 viewportTracker 的输入决策历史：

```js
// 单独调用 auto.scroll 时会先检查当前文档规模；
// 如果当前不是 5000 块，或滚动容器没有可滚动高度，会先自动注入 5000 块文档。
const report = await window.__EDITOR_PERF_BENCH__.auto.scroll({
  label: '5000-scroll-auto-run-1',
  blockCount: 5000,
  stepPx: 800
})

const summary = window.__EDITOR_PERF_BENCH__.manual.summarize(report)
console.dir(summary, { depth: null })
window.__EDITOR_PERF_BENCH__.manual.copySummary(report)
```

人工拖动滚动条时，也用 manual session 包住动作。重点记录：

- `histories.viewportTracker[*].decision`：是否频繁出现 `scroll-jump-preview`、`scroll-correction-preview`、`settled-correction-fired`。
- `histories.renderVirtualization[*].source`：窗口来源是 `height-cache`、`dom-anchor` 还是 `dom-sample`。
- `histories.renderVirtualization[*].durationMs`：拖拽期间是否出现超过 16ms 的刷新。
- 主观体感：滚动条是否不跟手、内容是否回弹、是否出现明显跳动。

---

## 6. 结果判读

### 6.1 如果这些指标已经明显下降

- `nodeView.activeByKind.vue` 稳定在 100-200；
- `blockChrome.editorListeners.total` 稳定接近 2；
- `dragOver.durationMs` p95 < 4ms；
- 滚动期间 `renderVirtualization.durationMs` 大多低于 16ms；

则阶段 1 的核心收割有效，下一步可以进入 `RootBlockRuntimeRegistry`。

### 6.2 如果仍然卡

按优先级判断瓶颈：

1. `renderVirtualization.durationMs` 高：窗口刷新 / DOM anchor / 高度缓存还有问题。
2. `decoration.summary.maxDurationMs` 高：插件 decoration 仍有 O(N) 或大批量构建问题。
3. `blockChrome.lifecycleActiveCount` 高：BlockChrome 挂载仍然太多，继续推进中央化 host。
4. `nodeView.activeByKind.vue` 高：窗口策略没有收住，或者 keepAlive/pinned 把窗口撑大。
5. `dragOver.durationMs` 高：拖拽命中测试仍在热点路径。

---

## 7. 当前待填结果

| 日期 | commit | 规模 | 场景 | run | 主观体感 | JSON 报告位置 / 摘要 |
|------|--------|------|------|-----|----------|----------------------|
| 待填 | 待填 | 500 | open | 1 | 待填 | 待填 |
| 待填 | 待填 | 1500 | open | 1 | 待填 | 待填 |
| 待填 | 待填 | 5000 | open | 1 | 待填 | 待填 |
| 待填 | 待填 | 10000 | open | 1 | 待填 | 待填 |
| 待填 | 待填 | 500 | menu | 1 | 自动化待跑 | `auto.scaleSuite()` |
| 待填 | 待填 | 1500 | menu | 1 | 自动化待跑 | `auto.scaleSuite()` |
| 待填 | 待填 | 5000 | menu | 1 | 自动化待跑 | `auto.scaleSuite()` |
| 待填 | 待填 | 10000 | menu | 1 | 自动化待跑 | `auto.scaleSuite()` |
| 待填 | 待填 | 500 | annotation | 1 | 自动化待跑 | `auto.scaleSuite({ scenarios: ['open', 'annotation'] })` |
| 待填 | 待填 | 1500 | annotation | 1 | 自动化待跑 | `auto.scaleSuite({ scenarios: ['open', 'annotation'] })` |
| 待填 | 待填 | 5000 | annotation | 1 | 自动化待跑 | `auto.scaleSuite({ scenarios: ['open', 'annotation'] })` |
| 待填 | 待填 | 10000 | annotation | 1 | 自动化待跑 | `auto.scaleSuite({ scenarios: ['open', 'annotation'] })` |
| 2026-05-19 | d74d12d7 | 10000 | scroll | 1 | 人工从顶部滚到底耗时过长，约 183.2s；不适合作为稳定 benchmark | `setContentMs=495ms`，`totalLoadMs=557ms`，`hydratedSetCount=100`，`hydratedDomCount=120`，`placeholderDomCount=9880`，`activeVueNodeView=122`，`BlockChrome active≈41/42` |
| 待填 | 待填 | 10000 | input | 1 | 待填 | 待填 |
| 待填 | 待填 | 10000 | selection | 1 | 待填 | 待填 |
| 待填 | 待填 | 10000 | drag | 1 | 待填 | 待填 |

### 7.1 2026-05-19 10000 scroll 人工全量滚动记录

这次结果的结论是：虚拟化窗口本身已经收住，但“人工从顶部滚到 10000 块底部”这个动作不适合作为后续标准测试。

关键记录：

- `openPerf.timings.setContentMs`: 495ms
- `openPerf.timings.setContentViewUpdateMs`: 448ms
- `openPerf.timings.totalLoadMs`: 557ms
- `virtualizationDiag.docRootBlockCount`: 10000
- `virtualizationDiag.dom.rootBlockDomCount`: 10000
- `virtualizationDiag.dom.placeholderDomCount`: 9880
- `virtualizationDiag.dom.hydratedDomCount`: 120
- `virtualizationDiag.hydratedSetCount`: 100
- `nodeView.activeTotal`: 122
- `nodeView.activeByKind.vue`: 122
- `nodeView.mountedTotalByKind.vue`: 1273
- `nodeView.unmountedTotalByKind.vue`: 1153
- `blockChrome.lifecycleActiveCount`: 41
- `blockChrome.activation.activeCount`: 42
- `scroll-top-to-bottom.durationMs`: 183210.3ms

判断：

- 阶段 1 的窗口压缩有效：10000 块下同时活跃 Vue NodeView 约 122，hydrated set 约 100。
- DOM 仍然保留 10000 个 rootBlock，其中大部分是 placeholder；这说明当前方案是“全量 rootBlock DOM + 局部 hydrated”，不是传统虚拟列表的“只保留可视 DOM”。
- 183 秒主要反映人工滚动路径过长，不能直接当作渲染耗时。后续用 `auto.scroll()` 或 `auto.scaleSuite()` 做标准滚动基线，人工滚动只保留 30 秒体感抽样。
- 这次还发现 `manual.copy(report)` 在页面失焦时会触发剪贴板权限错误；benchmark harness 已改为吞掉这个错误并返回 JSON 字符串。

### 7.2 2026-05-19 自动套件误跑旧 command 路径记录

这轮 `auto.scaleSuite({ blockCounts: [500, 1500, 5000, 10000], scenarios: ['open', 'menu', 'annotation', 'scroll'] })` 很有价值，但结论不是“虚拟化慢”，而是发现自动 benchmark 的文档注入路径没有复用真实打开文档链路。

关键异常：

- 500 / 1500 / 5000 / 10000 全部 `virtualizationEnabled=false`；
- 10000 档 `placeholderDomCount=0`、`hydratedDomCount=10000`；
- 10000 档 `nodeView.activeTotal=10119`，且全部为 Vue NodeView；
- 10000 open 的 `setContentMs=11931ms`，其中 `setContentViewUpdateMs=5961ms`；
- 10000 scroll 自动滚动约 `60859ms`，已经接近默认 `maxDurationMs=60000` 上限。

这说明当时测试到的是“全量 Vue NodeView + 全量 hydrated DOM”的旧 `command` 路径，不是当前虚拟化方案。该数据仍可作为旧路径对照基线，但不能用于判断 RenderVirtualization 的真实收益。

同时这轮也给了两个局部信号：

- 菜单 provider 本身很轻：`histories.blockActionMenu[*].totalMs` 在各规模大致为 `0.3-0.4ms`；外层 operation 的 300ms/900ms 主要包含等待和大 DOM 环境影响。
- 批注点击触发成本随规模上升：约 `4.9ms -> 6.4ms -> 13.7ms -> 31.3ms`。后续需要在命中真实虚拟化路径后再复测，避免全量 DOM 把批注链路放大。

修正动作：

- `run()` / `auto.open()` 默认 `loadMode='auto'`，复用产品真实策略；
- 1500+ 默认走 `direct-state`，并在初始 ProseMirror state 中写入 RenderVirtualization 状态；
- 注入后主动触发 `file-content-loaded`，让 RenderVirtualizationEngine 与目录等监听方按真实打开文档路径刷新；
- 只有显式 `{ loadMode: 'command' }` 或 `runComparison()` 的第一轮才保留旧路径对照。

### 7.3 2026-05-19 自动套件 1500 档卡住记录

修正真实加载路径后，第二轮自动套件在 1500 open 后卡住。日志显示这次已经命中虚拟化路径：

- `largeDocumentShellMode=true`
- `virtualRootBlockRenderingActive=true`
- `useDirectStateLoad=true`
- `enableVirtualRootBlockRendering=true`
- `NodeView 创建数: 1051 (vue=51, placeholder=1000)`

但这组 NodeView 数量本身异常：1500 档不应该只创建 1000 个 placeholder，也不应该继承上一轮 500 档的全量 Vue NodeView。原因是 benchmark 生成的 block id 之前是固定且非法的 `bench-block-*`：

- 500 档走 `command/setContent`，`UniqueIdsExtension` 会把非法 id 修成随机合法 `root-*`；
- 1500 档紧接着走 `direct-state`，老 DOM / NodeView 和新虚拟化状态发生复用与模式切换混杂；
- 自动套件连续跑不同规模时，前一轮文档会污染后一轮虚拟化判断。

修正动作：

- 压测文档直接生成合法 `root-*` id，避免触发 UniqueIds 修复事务；
- 每轮生成不同的 3 位 hex salt，让 500 / 1500 / 5000 / 10000 文档不会复用同一批 rootBlock id；
- 重新跑自动套件时，1500+ 的期望形态应回到约 `120 hydrated + 其余 placeholder`。

### 7.4 2026-05-19 自动套件完整跑通记录

这轮在修复 Outline 关闭时仍写入完整 `flatOutlineList` 的问题、以及滚动 benchmark 追逐旧 `maxScrollTop` 的问题后，完整 `scaleSuite` 已经能从 500 跑到 10000，不再卡在 1500。

执行命令：

```js
const reports = await window.__EDITOR_PERF_BENCH__.auto.scaleSuite({
  blockCounts: [500, 1500, 5000, 10000],
  scenarios: ['open', 'menu', 'annotation', 'scroll'],
  scrollStepPx: 1600
})
```

commit：`dfd13a6f`

| 规模 | open duration | menu duration | annotation duration | scroll duration |
|------|---------------|---------------|---------------------|-----------------|
| 500 | 1131.9ms | 303.6ms | 817.7ms | 855.7ms |
| 1500 | 1113.9ms | 306.5ms | 818.5ms | 3212.3ms |
| 5000 | 1239.8ms | 307.0ms | 834.1ms | 20993.6ms |
| 10000 | 1480.3ms | 315.3ms | 884.4ms | 65145.7ms |

判断：

- 首开主线已经明显收住：10000 open 约 `1.48s`，其中默认 settle 就占 `1000ms`，不再是旧 command 路径的十几秒级。
- menu 基本稳定在 `300ms` 左右，当前 operation 主要被固定等待时间覆盖；菜单 provider 自身仍需要看 `histories.blockActionMenu[*].totalMs`。
- annotation 从 500 到 10000 只从约 `818ms` 到 `884ms`，当前 operation 也包含固定等待；但压测文档不是数据库真实 block，因此仍会出现“目标块不存在，禁止写入附加数据”的持久化失败日志，这属于 benchmark 副作用噪音。
- scroll 仍是主瓶颈：5000 已到约 `21s`，10000 仍到约 `65s`。这说明首开 / 菜单 / 批注的规模问题已显著缓解，下一轮主线应转向滚动路径。
- 主观体感：5000 块开始，拖动滚动条已经出现不跟手和跳动。这个现象比纯 duration 更重要，说明滚动条拖拽路径里高度估算、scroll-correction、窗口刷新或 placeholder 高度回写已经影响交互稳定性。

注意：

- 本轮第一次汇总脚本直接读取了 `report.openPerf / report.nodeView / report.virtualizationDiag`，因此细项指标显示为 `null`。真实结构在 `report.finalSnapshot` 下。第 5.8 节已改成 `finalSnapshot ?? report` 的摘要脚本，下一轮需要重新采集 hydrated / placeholder / NodeView / Chrome active 等细项。
- 由于 10000 scroll 已经超过 60s，后续建议把滚动拆成单独 suite 反复跑，不要每次都和 open/menu/annotation 混在一起。
- 后续滚动优化必须同时记录“自动滚动耗时”和“手动拖动滚动条体感”。只看 `auto-scroll-top-to-bottom` duration 可能会漏掉滚动条跳动、位置回弹和不跟手。

### 7.5 2026-05-20 5000 scroll 专项收敛记录

阶段 1 的滚动专项已经把“高度轨道持续塌陷”压住，但没有解决手动拖动滚动条不跟手。

代表样本：

```json
{
  "blockCount": 5000,
  "stepPx": 800,
  "durationMs": 62258.4,
  "scrollHeightDelta": -271,
  "heightCache": {
    "startAdaptiveHeight": 32,
    "endAdaptiveHeight": 32,
    "startMeasuredCount": 32,
    "endMeasuredCount": 62
  },
  "finalNodeView": {
    "activeTotal": 88,
    "vue": 88
  },
  "renderVirtualization": {
    "eventCount": 160,
    "durationAvgMs": 40.9,
    "durationP95Ms": 45.1,
    "durationMaxMs": 496.9,
    "requestedHydrateAvg": 23.2,
    "requestedHydrateP95": 29
  }
}
```

判断：

- `scrollHeightDelta=-271` 说明高度轨道已经基本稳定，不再是之前 `-440281` 这种级别的滚动条塌陷。
- `startMeasuredCount=32 -> endMeasuredCount=62` 说明普通滚动期间已经停止沿途大量写入高度缓存，避免了“越拖越变”的主因。
- 手动拖动仍不跟手，且每次刷新仍平均 hydrate/dehydrate 约 23 个 Vue rootBlock，`renderVirtualization.duration.p95` 仍约 45ms。当前瓶颈已经从“高度估算错误”转为“入屏 Vue NodeView / BlockChrome 路径仍在滚动热路径里”。
- 因此阶段 1 不应继续靠参数微调硬磨，路线应进入阶段 2：建立 `RootBlockRuntimeRegistry`，然后把 hydrated rootBlock 壳从 `VueNodeViewRenderer(BlockView)` 迁到裸 DOM NodeView。

### 7.6 2026-05-20 阶段 2 Step 2 接入记录

阶段 2 Step 2 已接入首版裸 DOM hydrated rootBlock：

- 虚拟化大文档的 hydrated rootBlock 改走 `RootBlockDomNodeView`；
- placeholder 仍走 `PlaceholderShellView`；
- 普通小文档仍走 Vue `BlockView`；
- `RootBlockDomNodeView` 注册 `RootBlockRuntimeRegistry` handle，并发布 `nodeViewLifecycle`，让 handshake 不再依赖 Vue 实例。

下一轮 5000 scroll 验证重点：

- `finalNodeView.activeByKind.dom` 应成为 hydrated rootBlock 主体，`activeByKind.vue` 应明显下降；
- `editorOpenPerf.nodeViewStats.rootBlockDomNodeViewCount` 应记录 DOM 壳创建数；
- `renderVirtualization.duration.p95` 应低于阶段 1 的约 `45ms`；
- 手动拖动滚动条应观察“是否仍落后鼠标、是否松手回弹、是否 overshoot 后回拉”。

已知阶段边界：裸 DOM 壳暂时不挂每块 `BlockChrome`。块级菜单、批注入口、修订 header 等 chrome 恢复属于阶段 3 `BlockChromeHost` 中央化，不能为了短期补 UI 又把每个 rootBlock 拉回 Vue 壳。

### 7.7 2026-05-20 原生滚动条拖拽脱钩记录

用户手动拖动滚动条反复上下时，观察到“滚动条越来越离鼠标远”。这不是单轮渲染耗时问题，而是拖拽期间文档 `scrollHeight` 仍在变化：

- 即使普通滚动已经停止写入 `BlockHeightCache`；
- 每次窗口刷新仍会把一批 placeholder 替换为 hydrated DOM；
- hydrated DOM 的真实布局高度和 placeholder 的 `min-height` 不可能完全一致；
- 浏览器原生滚动条的 thumb 位置按 `scrollTop / maxScrollTop` 映射，`maxScrollTop` 边拖边变，就会出现 thumb 和鼠标逐渐脱钩。

修正策略：

- `viewportTracker` 识别按住右侧原生滚动条拇指的拖拽；
- 拖拽期间只更新内部 `scrollTop` 观察值和 settled correction timer，不调度 RenderVirtualizationEngine；
- 松手或窗口失焦后，再执行一次 `scroll-correction`，用 DOM sample 水合当前视口。

预期体感：

- 滚动条 thumb 应该更贴手，不再反复上下后逐渐跑到鼠标下面；
- 拖拽过程中内容可能暂时停留在旧 hydrated window / placeholder 状态；
- 松手后约 `SCROLL_SETTLE_CORRECTION_MS=220ms` 再补齐当前视口内容。

验证结果：

- 用户手动拖动原生滚动条反复上下后，滚动条 thumb 已经非常跟手，不再持续脱离鼠标；
- 内容区在按住 thumb 期间不会实时完整跟随，松手后再补齐当前视口内容；
- 这是当前阶段的明确取舍：拖拽 thumb 时不允许 hydrate/dehydrate 扰动 `scrollHeight`，优先保证浏览器原生滚动条映射稳定。

后续方向：

- 不继续在滚动参数上硬磨；
- 回到路线图阶段 3，推进 `BlockChromeHost` 中央化，减少入屏 Vue chrome 对普通滚动热路径的影响。

---

## 8. 下一步决策

当前已经完成 500 / 1500 / 5000 / 10000 的 open、menu、annotation、scroll 第一轮自动基线。结论是：首开、菜单、批注已经基本收住，下一步不应该继续“专攻 5000 首开”，而应该进入滚动路径专项。

2026-05-20 更新：滚动条拖拽脱钩已通过“拖拽 thumb 期间不调度虚拟化刷新、松手后再 correction”收住；BlockChromeHost 也已接管大文档路径的 left-handle、annotation-handle、annotation-panel 挂载层、revision-indicator、revision-toolbar 和 history-panel。当前下一步不再是继续调滚动参数，而是进入阶段 3 收口回归：补 1500 pending + history + annotation 手动样本，并用 5000/10000 open + scroll 做外推确认。

2026-05-20 pending 回归记录：`__REVISION_TEST__.inject(1500)` 已通过。后端 pending 写入 `1500/1500`，读回 `1500`；`canonicalBlockCount=1500`，`activeRevisionCount=0`，`RevisionPerf.totalMs=4ms`。这说明大文档路径已经进入 canonical-only 首开策略，没有全量投影 `revisionMark`，符合虚拟化路线。剩余观察点是远距离滚动到未投影区域后，当前可见窗口的 pending 行内视图需要等待 hydrate + projection 补齐，后续应优化可见区投影优先级，而不是回退到首开全量投影。

2026-05-20 pending 外推记录：5000 pending 远距离滚动补齐体验可接受。采样窗口 `visibleCount=90 / hydratedCount=90`，projection 仍按 `8 blocks` 小批次推进；观测到批次耗时约 `31.1ms / 38.8ms`，最终样本出现 `no-candidates` 且 `skippedActiveCount=90`，说明当前窗口 pending 已全部进入 active 投影层，没有漏投影。风险点：单批 30–40ms 已超过单帧预算，10000 pending 需要继续观察是否升高；如继续升高，优先研究按 Markdown complexity 动态缩小批次或拆分 heavy block，而不是扩大首开投影。

2026-05-20 pending 10000 外推记录：远距离滚动时窗口规模仍稳定在 `visible/hydrated≈89–90`，没有看到漏投影，但 projection 批次耗时明显升高。采样中首个 `8 blocks` 批次出现 `1185.9ms` 冷启动峰值（`candidateCount=62`、`projectedCount=8`、`skippedActiveCount=27`），后续仍有 `129.2ms`（`candidateCount=20`、`projectedCount=8`）和 `136.6ms`（`candidateCount=5`、`projectedCount=5`）。结论：可见窗口优先策略方向正确，但 10000 pending 下单批投影已成为新的瓶颈；下一步应研究 `applyPendingRevisionsToEditor` 的批内耗时拆分、冷启动成本和动态 batch size，而不是继续调整滚动条或恢复首开全量投影。

2026-05-20 pending 10000 fast-path 修复后复测：压测文本 `测试块 #n ... [AI修订 #n]` 已从 `runtime-single-block` 回到 `plain-text-fast-path`，最近批次 `slowestSource=plain-text-fast-path`，`resolve=0`。最近 10 批中 8-block 批次约 `19.8–68.8ms`，尾批 `5 blocks=16.9ms`；主要剩余成本为 `dispatch≈10–13ms`、`locate≈4–9ms`，以及 prepare 阶段的调度等待（部分批次 `prepare≈30–50ms`，但单块 `slowestPrepare≈0.2–0.4ms`）。结论：原先 10000 pending 的秒级慢批根因已收敛为“普通文本误入 Markdown runtime”；剩余优化方向是减少投影批次里的调度等待与 transaction 定位/dispatch 常数，而不是再改 Markdown runtime。

2026-05-21 pending 10000 跳过短普通文本固定 prepare yield 后复测：最近 10 批全部为 `source=plain-text-fast-path`、`resolve≈0`、`yield=0`。8-block 批次稳定在 `19.3–28.3ms`，尾批 `2 blocks=13.0ms`；`prepare` 从上一轮部分 `30–50ms` 降到常态 `1.2–2.6ms`，仅单批出现 `6.7ms`。剩余主要成本已经转移到 `dispatch≈10.3–11.9ms` 和 `apply/locate≈7.3–11.2ms`。结论：Markdown runtime 误判和固定调度等待已经收口，下一步若继续优化 pending projection，应研究 `megaTr` 应用阶段的 block 定位与 dispatch 常数，而不是扩大投影窗口、恢复首开全量投影或继续调整滚动条策略。

2026-05-21 pending 10000 复用 prepare 阶段 block 位置后复测：最近 10 批仍全部命中 `source=plain-text-fast-path`、`yield=0`。8-block 批次进一步稳定到 `13.4–14.6ms`，尾批 `2 blocks=12.1ms`；`locate=0`，`apply≈1.4–1.5ms`，`prepare≈1.4–1.6ms`，主导成本变成单次 `dispatch≈10.4–11.4ms`。结论：pending projection 的批内定位常数已经消除，当前大文档 pending 入屏投影基本到达现有 ProseMirror transaction dispatch 架构下的稳定地板；除非体感仍有明显卡顿，否则下一步优先做阶段 3 收口回归和旧路径清理，不急着继续拆 dispatch。

执行顺序：

1. 先跑 1500 pending + history + annotation 手动回归，因为这三类最容易在 Host 迁移中出现 UI 语义回归。
2. 再跑 5000 open + scroll，确认滚动条手感、`finalNodeView.vue`、`renderVirtualization.duration.p95` 和 `scrollHeightDelta` 没有倒退。
3. 最后跑 10000 open + scroll 外推验证；如果 10000 只在内容补齐速度上慢但滚动条仍跟手，优先记录为阶段边界，不急着扩大架构。
4. 如果某个 surface 出现回归，回到对应 feature 的 read-model / orchestration 边界修复，不把规则塞回 Host。

判断分支：

- `histories.viewportTracker` 里 `scroll-jump-preview` / `scroll-correction-preview` 过密：优先研究原生滚动条拖拽期间的预览策略和 settled correction 时机。
- `histories.renderVirtualization[*].durationMs` 经常超过 16ms：优先研究窗口规划、DOM anchor / sample、height cache 读取与 ProseMirror dispatch。
- `histories.renderVirtualization[*].source` 在 `height-cache` 和 `dom-sample` 之间频繁切换：优先研究高度估算和纠偏策略，避免内容回弹。
- `nodeView.activeByKind.vue` 或 `blockChrome.activation.activeCount` 又明显膨胀：回到窗口数量、pinned 集合、BlockChrome 激活链路。
- 自动滚动耗时下降但人工拖动仍不跟手：说明问题更偏输入反馈和 scroll correction，而不是总渲染吞吐。
