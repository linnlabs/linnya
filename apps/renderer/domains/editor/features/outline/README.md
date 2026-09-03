# Outline

`Outline` 是编辑器的文档目录功能，负责根据 `headingBlock` 提供当前文档窗口左侧 hover 目录触发条、目录面板、标题跳转、折叠展开和大目录窗口化渲染。

一句话心智模型：

> 目录 presence 是首开能力，目录列表是用户打开目录后的懒能力。

大文档首开时，目录不能因为文档里存在标题就立刻构建和写入完整目录列表。完整列表会驱动 Vue 派生计算、列表渲染、虚拟窗口和过渡逻辑，必须等用户真正打开目录时再构建。

## 大文档约束

1500+ rootBlock 大文档下，编辑器首开的优先级是：

1. ProseMirror doc 完整加载。
2. RenderVirtualization 只 hydrate 首屏窗口。
3. 编辑器尽快恢复输入、点击和滚动。
4. 目录只发布“是否存在标题”这个轻量状态。
5. 用户打开目录后再构建完整标题列表。

因此 `file-content-loaded` 后的目录更新必须遵守：

- 可以扫描文档判断是否存在 `headingBlock`。
- 可以更新 `hasHeadings / outlineReady`，让目录按钮出现。
- 目录关闭时禁止写入完整 `flatOutlineList`。
- 目录关闭时如果有旧列表，需要清空旧列表，避免隐藏目录继续参与大文档响应式更新。
- 目录打开时才收集标题详情、构建树、写入列表。

核心策略在 `functions/outlineUpdatePolicy.ts` 中维护，并有单元测试保护。

## 卡死根因回顾

曾经出现过一个稳定复现的卡死：

```ts
window.__EDITOR_PERF_BENCH__.auto.openDetached({
  blockCount: 1500,
})
```

当 benchmark 默认生成标题块时，renderer 会在首开后卡死；当设置 `headingInterval: 0` 不生成标题块时，benchmark 可以跑完。

最终证据链是：

1. `direct-state` 注入 1500 块只需要约百毫秒，且虚拟化后 hydrated Vue NodeView 只有几十个，不是根因。
2. `file-content-loaded` 同步监听器耗时很低，不是同步事件栈卡住。
3. `setHasHeadings(true)` 自身写入耗时也很低，不是 boolean 状态写入卡住。
4. 真正的差异在于：有标题时旧逻辑会在目录关闭状态下仍然构建并写入完整 `flatOutlineList`。
5. 这个隐藏列表写入触发 `visibleOutlineList / isLargeOutline / virtualOutlineWindow / transition-group` 等 Vue 派生状态和渲染队列，最终把 renderer 拖入长任务。

修复后的规则是：

```text
目录关闭 + 文档有标题
-> 只发布 hasHeadings=true
-> 不收集标题详情
-> 不构建 flatOutlineList
-> 不触发目录列表渲染链路
```

这个修复解决的是“大文档首开被隐藏目录拖死”的根因。

## 打开目录时的行为

用户 hover 当前文档窗口左侧短灰色竖条或点击固定目录时，`OutlineSidebar` 会重新执行 `updateOutline()`：

```text
outlineVisible=true 或 outlinePreviewVisible=true
-> 收集 headingBlock 详情
-> buildFlatList(...)
-> 写入 flatOutlineList
-> 小目录使用 transition-group
-> 大目录使用窗口化渲染
```

触发条和面板都通过 `<Teleport to="body">` 挂到浮层，但位置必须由当前文档 pane 的 `getBoundingClientRect()` 测量得到。触发条应保持类似滚动条 thumb 的短灰色竖条：视觉上窄、短、低存在感，交互热区可以比视觉条稍宽。不要再把目录 left 偏移绑定到 `sidebarWidth`，也不要写死成整个 app 的 `left: 0`：工作区文档可能位于主区域、右侧文档栏或中间区域，目录应该稳定贴当前文件窗口左侧。

触发条的展开态和固定态必须分开表达：`aria-expanded` 可以由 hover 预览或点击固定共同驱动，但 `is-active` / `is-pinned` 只能表示点击后的固定目录。hover 只是临时预览，颜色应保持灰色，不能拿固定态的绿色。

垂直位置也不能写死。触发条按当前文件窗口的可用高度放在约 30% 的中偏上位置；目录面板根据 `visibleOutlineList.length` 估算自然高度，短目录围绕触发条展开，长目录向可用区域上方扩展并受当前文件窗口边界约束。相关规则在 `functions/outlineFloatingGeometry.ts`，不要把新的 top 计算散落回 Vue/CSS。

hover 预览关闭时必须立刻清空 `flatOutlineList`。否则用户只是短暂看过目录，隐藏列表仍会在大文档里参与 Vue 派生计算，等价于重新引入“关闭目录仍写完整列表”的性能风险。

这意味着首开不会再被目录列表阻塞，但如果 5000 / 10000 块文档里有大量标题，首次 hover 或固定目录仍可能有一次构建开销。后续要继续优化时，优先考虑：

- `hasHeadings` 扫描找到第一个标题后早停。
- 将标题列表构建拆到纯函数并增加更完整测试。
- 大标题量下分片构建或维护轻量 heading index。
- 继续禁止大目录使用 `transition-group` 并保持窗口化渲染。

## 状态边界

`store/useOutlineRuntimeState.ts` 只保存目录 feature 内部的轻量运行时 presence：

- `hasHeadings`
- `outlineReady`
- `outlinePreviewVisible` 及其 hover/focus 输入状态
- 当前文档窗口左边界测量值

它不能持有完整标题列表，也不能反向调用目录构建流程。完整标题列表目前由 `OutlineSidebar.vue` 内部维护；后续如果需要共享，应提升到 outline feature 自己的 store，并保持“关闭目录不写完整列表”的约束。

## 回归测试

策略测试：

```bash
npx vitest run apps/renderer/domains/editor/features/outline/functions/outlineUpdatePolicy.test.ts
```

手工性能验证：

```ts
window.__EDITOR_PERF_BENCH__.auto.openDetached({
  blockCount: 1500,
})
```

放大验证：

```ts
window.__EDITOR_PERF_BENCH__.auto.openDetached({
  blockCount: 5000,
})

window.__EDITOR_PERF_BENCH__.auto.openDetached({
  blockCount: 10000,
})
```
