# RenderVirtualization Integration Tests

`integration/` 放虚拟化跨层门禁测试，不替代 `controller/`、`state/`、`runtime/`、`view/` 的单点测试。

## 职责

- 模拟一个最小 Editor / ProseMirror view / scrollRoot / runtime registry 组合。
- 验证 Engine snapshot、plugin state、runtime handle、Host surface target 之间的协作。
- 固化滚动条拖拽、cleanup、hydrated-like window 等阶段 2/3 高风险边界。
- 验证真实 `RevisionStore` canonical pending 层参与 Shell pending 投影，避免未来拆 registry / bridge 时把 pending 路径改回 mock-only。
- 用 `*.design-gate.test.ts` 记录尚未进入实现的结构性边界目标；这类测试可以使用 `it.fails` 表达“当前已知不满足，重构完成后应转正”。已经完成的门禁要及时转成普通通过测试。

## 非职责

- 不测试 Annotation / Revision / BlockHistory 的完整业务规则。
- 不启动真实 Vue 组件树，不做浏览器端视觉断言。
- 不为了让测试简单而改主路径行为。
- 不在 integration harness 内实现真实 Tiptap 编辑器；需要真实浏览器事件和完整 Vue 树时，应升级到 e2e / perf bench。

## 当前门禁

- Engine hydrated window 可以同步出 runtime handle，并被 BlockChromeHost target resolver 消费。
- Host 只为当前 hydrated runtime handle 生成 surface；离屏 active block 不应生成挂载目标。
- 原生滚动条拖拽期间不 hydrate/dehydrate，松手后由 settled correction 更新窗口。
- 原生滚动条被按住并反复上下拖动时，拖拽期间不能调度 hydrate/dehydrate；这是 5000 / 10000 体感“滚动条不脱离鼠标”的核心门禁。
- Engine cleanup 取消排队 refresh，并清空 runtime handle。
- scrollHandshake 文档切换门禁：旧 editor cleanup 后，迟到的 handshake waiter / timer 不能污染使用相同 blockId 前缀的新 editor。
- 真实 `RevisionStore` 注入大批量 canonical pending 后，只有 hydrated window 会被 Shell bridge 批量投影，滚动到新窗口后继续投影新块。
- per-editor 运行期表门禁已转正：清理 editor A 不应清掉 editor B 的 runtime handle、NodeView lifecycle entry 或 BlockHeightCache 测量值。
- selection keep-alive 统一门禁已转正：selectionUpdate / engine refresh 会进入 `KeepAliveRegistry(reason='selection')`，plugin state 不再持有 selection 保活字段；选区移动只能释放旧块的 selection 租约，不能误释放 revision toolbar / history panel / annotation 等其他入口持有的租约。

## 重要约定

Engine snapshot 的 `hydratedBlockIds` 表示当前实际 hydrated-like 窗口，可能包含 selection / pinned 块；它不等同于 plugin state 的裸 `hydratedSet`。集成 harness 必须用 Engine snapshot 同步 runtime handle，避免把 selection/pinned 保活路径误判成未挂载。

## 稳定维护体验门禁

后续任何触碰 runtime owner、viewportTracker、public/internal 边界、KeepAlivePort、pending projection 或 Host chrome 的结构性改动，启动前必须先确认当前体验基线没有倒退：

- 真实文档切换 / 加载不能出现 Vue `instance.update is not a function`、unmount 空实例或旧 `BlockChrome` setup 顺序错误。
- 5000 / 10000 原生滚动条拖拽必须保持跟手；按住滚动条反复上下时，拇指不能逐渐跑到鼠标下方或上方。
- 拖拽滚动条期间允许内容暂时等待松手后补齐，但松手后必须由 settled correction 补齐当前窗口。
- 10000 pending 文档保持 canonical-only 首开；pending header 只按 hydrated window 投影，不能回到首开全量 `revisionMark`。
- Host chrome 的 left handle、annotation handle、revision indicator、revision toolbar、history panel 只能挂到当前 editor owner 的 runtime target，不能跨 editor 复用同名 blockId。

## 运行

```bash
npm test -- \
  apps/renderer/domains/editor/features/RenderVirtualization/integration/renderVirtualization.integration.test.ts \
  apps/renderer/domains/editor/features/RenderVirtualization/integration/scrollHandshake.integration.test.ts \
  apps/renderer/domains/editor/features/RenderVirtualization/integration/pendingProjection.integration.test.ts \
  apps/renderer/domains/editor/features/RenderVirtualization/integration/perEditorRegistry.design-gate.test.ts \
  apps/renderer/domains/editor/features/RenderVirtualization/integration/selectionKeepAlive.design-gate.test.ts
```
