## Node Addons（节点扩展）README

> 中文说明：
> - Node Addons 是“白板方向”的关键基础设施：让节点下方可以挂载引用/图片/卡片/预览等扩展 UI。
> - 目标：feature 只负责 register/unregister，不允许自己到处 Teleport/查 DOM/散落交互拦截。
>
> 最后更新：2026-02-04

---

## 1) 统一挂载点：`.mm-topic-addons`

- **创建位置**：`shared/utils/dom/index.ts` 的 `shapeTpc()` 会为每个 `mm-topic` 创建一个 `.mm-topic-addons`
- **交互门禁**：容器默认带 `data-mm-interactive="true"`，由 InteractionGate 统一处理交互穿透

> 中文说明：addon 内部如果还有按钮/输入框等交互元素，最外层容器也应保持 `data-mm-interactive="true"`（或在 Vue 模板使用 `interactiveProps()`）。

---

## 2) 注册表：`getNodeAddonsRegistry(mind)`

- 实现：`presentation/addons/nodeAddonsRegistry.ts`
- 注册形状：`NodeAddonRegistration`
  - `id`：唯一（建议 `feature:addonName`）
  - `order`：渲染顺序
  - `component`：Vue 组件（props 必须是 `{ mind, nodeId }`）
  - `track?`：声明响应式依赖（纯读取，无副作用）
  - `shouldRender(ctx)`：纯函数判断是否渲染

---

## 3) 统一渲染器：`presentation/ui/NodeAddonsHost.vue`

Host 负责：
- 遍历当前 DOM 可见节点的 `.mm-topic-addons[data-nodeid]`
- 将 `domId` 立刻转换为业务 `nodeId`（`fromDomNodeId()`）
- 根据 registry 决定每个 addon 是否渲染，并 Teleport 到对应容器
- 在渲染完成后触发 `mind.requestReflow('addons:content')`（由 scheduler 合并）

---

## 4) addon 组件契约（强制）

- **props**：必须接受 `({ mind, nodeId })`
- **交互门禁**：根容器必须带 `data-mm-interactive="true"`
- **尺寸变化**：任何导致节点高度变化的行为必须调用：
  - `mind.requestReflow('addons:toggle')` 或 `mind.requestReflow('addons:content')`

禁止事项：
- ❌ addon/feature 调用 `mind.layout()` 或 `mind.linkDiv()`
- ❌ feature 自己实现“全局 v-for + Teleport”扫描 DOM（统一由 Host 做）

