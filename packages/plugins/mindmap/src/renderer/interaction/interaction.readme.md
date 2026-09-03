## Interaction（交互体系）README（开发指南）

> 中文说明：
> - 交互层负责把 RawEvent 提纯为 Intent，并路由到 `mind.commands.*` 或 `ui:*`。
> - selection 是并行 RawEvent 消费者（独立子系统），不强行纳入 intent 捕获层。
>
> 最后更新：2026-02-05

---

## 1) 总体流水线

- RawEvent（click/dblclick/wheel/keydown 等）
- InteractionGate（门禁：阻止 addon 等交互穿透）
- Intent（可序列化 payload，禁止 DOM/Topic 泄漏）
- Dispatcher（统一注入 traceId/source，落到 commands 或 ui:*）

---

## 2) 目录结构（代码事实）

- 事件绑定与分发：`interaction/mouseHandlers.ts` + `interaction/handlers/*`
- Intent：`interaction/intents/*`
- 键盘治理：`interaction/keyboard/*`（KeymapRegistry + defaultKeymap + install）
- Selection：`interaction/selection/*`（独立子系统，含 adapter/core/utils）

---

## 3) 键盘规则（必须遵守）

- **✅ 做**：通过 `KeymapRegistry` 注册快捷键，并最终调用 `mind.commands.*`（或 fire `ui:*`）
- **❌ 禁止**：feature/模块私自 `addEventListener('keydown')` 接管业务快捷键（会造成不可治理的冲突）

---

## 4) Selection 与 Intent 的边界

- selection 负责“选中状态”的维护与输出（`state:selectNodes/state:unselectNodes`）
- intent 负责其它入口的业务意图路由（例如展开/编辑/视图操作等）

> 任何想“重做 selection”的改动，都必须先写清 ownership 与回归用例，否则极易引入交互竞争回归。

---

## 5) 结构性重建交互（focus/refresh 等）

> 中文说明：这类交互会触发结构重建（重建节点 DOM），因此对 AutoRefresh/Feature 初始化有重要影响。

- **相关 API**：`focusNode(el)` / `cancelFocus()` / `refresh(data)`
  - 实现位置：`interaction/dataControls.ts`
  - 行为特征：会触发结构性重建，并发出 `lifecycle:structureReady`
- **典型入口**：
  - 右键菜单：`presentation/ui/MindMapContextMenu.vue`（`instance.focusNode()` / `instance.cancelFocus()`）
- **约束**：
  - 不要在结构重建过程中“猜测 DOM 就绪”（禁止固定延时）；需要接续逻辑必须监听 `lifecycle:structureReady`

