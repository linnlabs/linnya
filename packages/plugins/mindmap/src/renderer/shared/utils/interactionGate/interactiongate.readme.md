# InteractionGate（交互门禁）

> 中文说明：这是 **MindMap 的交互基础设施 README**（固化版），用于统一处理"事件是否应该触发选择/拖拽/画布移动"等行为。  
> 目标是把交互过滤从"到处散落判断"收敛为"一个入口 + 一套标记规范"，提升稳定性与可维护性。

---

## 解决什么问题

MindMap 节点内部会有越来越多的交互元素：

- 证据组件的按钮/输入框
- 富内容渲染后的链接/按钮
- 未来可能的各种扩展 UI

如果每个交互入口（selection/drag/pan）都自行判断"这个元素该不该处理"，会导致：

- **过滤规则散落**：到处都在写 `className === 'xxx'` / `contentEditable !== 'xxx'`
- **容易遗漏**：新增 feature 时忘了处理某个入口，导致"点按钮却触发了拖拽"
- **难以排查**：出问题时不知道是哪个入口的判断逻辑出错

InteractionGate 的职责就是：**统一提供"应该忽略吗"的判断 API，并通过 data 标记让 feature 声明式地控制交互行为**。

---

## 文件位置（实现）

- 实现：`packages/plugins/mindmap/src/renderer/shared/utils/interactionGate/InteractionGate.ts`
- 导出：`packages/plugins/mindmap/src/renderer/shared/utils/interactionGate/index.ts`
- 已接入的交互入口：
  - `interaction/mouseHandlers.ts`（事件绑定与路由）
  - `interaction/handlers/pointerPan.ts`（画布移动）
  - `interaction/selection/adapters/MindMapSelectionAdapter.ts`（框选）
  - `interaction/nodeDraggable.ts`（节点拖拽）

---

## 覆盖清单（Phase 4，必须）

> 中文说明：这部分用于“审计交互入口是否都接入 Gate”，避免新增 addon/交互后出现穿透回归（点按钮触发选择/拖拽/平移）。

### 1) 覆盖入口清单

#### Selection（框选/点选）
- **入口文件**：`interaction/selection/adapters/MindMapSelectionAdapter.ts`
- **使用 Gate**：`shouldIgnoreSelection(ctx)`
- **覆盖目标**：
  - addon 内部交互元素（带 `data-mm-interactive`）点击不会触发 selection
  - 右键不会触发 selection（Gate 内置）

#### Drag（节点拖拽）
- **入口文件**：`interaction/nodeDraggable.ts`
- **使用 Gate**：`shouldIgnoreDrag(ctx)`
- **覆盖目标**：
  - addon 内部交互元素不会触发节点拖拽

#### Pan（画布平移）
- **入口文件**：`interaction/handlers/pointerPan.ts`
- **使用 Gate**：`shouldIgnorePan(ctx)`
- **覆盖目标**：
  - addon 内部交互元素拖动不会触发画布移动
  - 空格/移动模式拖拽不受 Gate 阻挡（用户明确意图）

#### ContextMenu（右键菜单）
- **入口文件**：`interaction/handlers/contextmenu.ts`
- **建议使用 Gate**：`shouldIgnoreContextMenu(ctx)`（当前实现恒 false，可作为扩展点）
- **覆盖目标**：
  - 后续如需“交互控件右键不弹菜单”，可在 Gate 内统一扩展

#### Wheel（滚轮）
- **入口文件**：`interaction/handlers/wheel.ts`
- **Gate 策略**：保持现状（目前不做 Gate 过滤）
- **覆盖目标**：
  - ctrl/meta 缩放、shift 横向平移、否则自由平移

### 2) addon/UI 约束（必须）

#### 必须声明交互边界
任何 addon 组件的根容器必须添加：
- `data-mm-interactive="true"`（推荐使用 `interactiveProps()`）

#### 禁止在入口散落判断
禁止在 `mouseHandlers` / selection adapter / draggable 等入口写：
- `className === ...`
- `contentEditable !== ...`
- `closest('.xxx')` 的 ad-hoc 规则

必须统一扩展到 `InteractionGate.ts`：
- `BUILTIN_*_SELECTORS`
- 或通过 data marker（优先）

### 3) 最小验收用例（建议）
- 点击 addon 内按钮：不触发 selection/drag/pan
- 在空白区域拖动：能平移画布（按现有逻辑）
- 空格按下拖动：强制平移画布（绕过 Gate）

---

## Data 标记规范

### `data-mm-interactive="true"`

标记为"交互元素"，带此标记的元素及其子元素：
- 点击不会触发节点选择
- 拖拽不会触发节点拖拽
- 不会触发画布移动

**使用场景**：证据组件、富内容内的按钮/链接、任何需要响应点击的 UI。

```html
<div data-mm-interactive="true">
  <button>点我不会选中节点</button>
</div>
```

### `data-mm-ignore-selection="true"`

仅忽略选择，不影响拖拽/画布移动。

### `data-mm-ignore-drag="true"`

仅忽略拖拽，不影响选择/画布移动。

### `data-mm-ignore-pan="true"`

仅忽略画布移动，不影响选择/拖拽。

---

## Gate API

### shouldIgnoreSelection(ctx, options)

判断是否应该忽略选择。

```typescript
import { shouldIgnoreSelection } from '../shared/utils/interactionGate'

// 在 filterTarget 中使用
if (shouldIgnoreSelection({ target, event, boundary: mind.container })) {
  return false // 不交给 selection 引擎处理
}
```

### shouldIgnoreDrag(ctx, options)

判断是否应该忽略拖拽。

```typescript
import { shouldIgnoreDrag } from '../shared/utils/interactionGate'

// 在 dragstart 中使用
if (shouldIgnoreDrag({ target, event: e, boundary: mind.container })) {
  e.preventDefault()
  return
}
```

### shouldIgnorePan(ctx, options)

判断是否应该忽略画布移动。

```typescript
import { shouldIgnorePan } from '../shared/utils/interactionGate'

// 在 pointerdown 中使用
if (shouldIgnorePan({ target, event: e, boundary: mind.container })) {
  return // 不启动画布拖拽
}
```

### isInteractiveElement(ctx, options)

判断目标元素是否是"交互元素"（带标记或内置交互元素）。

---

## 内置的"交互元素"

以下元素无需手动添加 `data-mm-interactive`，Gate 会自动识别：

- `[contenteditable="true"]` / `[contenteditable="plaintext-only"]`
- `input` / `textarea` / `select` / `button`
- `.circle`（连线控制点）
- `.svg-label-editor`（SVG 标签编辑器）
- `mm-expander`（折叠/展开按钮）

---

## 便捷工具（Vue 组件）

```typescript
import { interactiveProps } from '../shared/utils/interactionGate'

// 在模板中使用
<div v-bind="interactiveProps()">...</div>

// 等价于
<div data-mm-interactive="true">...</div>
```

---

## 研发约束

### 新增 feature 时

1. 如果 feature 包含按钮/输入框等交互 UI，在**最外层容器**添加 `data-mm-interactive="true"`
2. 不需要手动修改 `mouseHandlers.ts` / `MindMapSelectionAdapter.ts` 等交互入口
3. Gate 会自动识别标记并过滤

### 新增交互入口时

1. 在入口处调用对应的 Gate API（`shouldIgnoreSelection` / `shouldIgnoreDrag` / `shouldIgnorePan`）
2. 不要自己写 `className === 'xxx'` 这种散落判断
3. 如果需要新增内置过滤规则，在 `InteractionGate.ts` 的 `BUILTIN_*_SELECTORS` 中添加

---

## 调试

所有 Gate API 都支持 `debug` 选项：

```typescript
shouldIgnoreSelection(ctx, { debug: true })
```

开启后会在控制台输出匹配到的规则，便于排查"为什么点击没反应"或"为什么点击触发了选择"。

### 一键开启（推荐）
MindMap 已提供开发态开关，便于统一开启所有入口的 Gate debug：

```typescript
mind.bus.debug.interactionGate.setEnabled(true)
```

---

## 常见排查清单

- **点击按钮却触发了节点选择/拖拽**
  - 检查按钮的祖先元素是否有 `data-mm-interactive="true"`
  - 或者按钮本身是否是 `<button>` 标签（内置识别）

- **点击节点内容没有选中节点**
  - 检查点击目标是否误触发了某个交互标记
  - 开启 `debug: true` 看日志

---

*最后更新：2026-02-02*
