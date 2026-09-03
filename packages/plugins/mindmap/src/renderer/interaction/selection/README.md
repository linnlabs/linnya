# MindMap Selection 模块

思维导图的框选与多选引擎，完全内化为项目自维护模块。基于"协调器"架构，将输入识别、业务逻辑、DOM 渲染解耦为独立模块。

---

## 架构概览

```
Selection Module
├─ INPUT LAYER (输入层)
│  └─ InputObserver
│     ├─ DOM 事件监听（mousedown, touchstart, mousemove...）
│     └─ 手势识别（点击 vs 拖拽，阈值检测）
│
├─ LOGIC LAYER (逻辑层)
│  ├─ SelectionStrategy
│  │  └─ 纯函数式决策（Shift/Ctrl/Cmd 选择、范围选中）
│  └─ SelectionStoreManager
│     └─ 选中状态维护与 Store 更新
│
├─ RENDER LAYER (渲染层)
│  └─ SelectionRenderer
│     └─ 选框 DOM 创建、重绘、样式管理
│
├─ COORDINATOR (协调器)
│  └─ SelectionEngine
│     └─ 组装上述模块，管理事件流与生命周期
│
└─ ADAPTERS (适配层)
   ├─ MindMapSelectionAdapter
   │  └─ 与 MindMap 业务逻辑对接（选中/取消选中触发 bus 事件）
   ├─ actions/nodeActions.ts
   │  └─ 对外暴露的公共 API（select/deselect）
   └─ utils/
      └─ 事件、几何、DOM 工具函数（仅内部使用）
```

---

## 核心模块说明

### 🔵 core/InputObserver.ts
**职责**：DOM 事件捕获与手势识别。

- **功能**：
  - 监听 `mousedown`、`touchstart` 等事件。
  - 通过像素阈值判定"点击"vs"拖拽"。
  - 自动管理事件监听器的绑定/解绑。

- **输出事件**：
  - `down`：触摸/按下
  - `start`：拖拽开始（超过阈值）
  - `move`：拖拽中
  - `stop`：拖拽结束
  - `tap`：单次点击（未超过阈值）
  - `scroll`：滚轮/键盘滚动

- **解耦点**：完全不依赖选择逻辑，只负责事件流。

### 🟢 core/SelectionStrategy.ts
**职责**：纯函数式的选择决策逻辑。

- **方法**：
  - `resolveClick(target, evt, context, options)` - 根据按键状态决定选中/反选/范围
  - `getSelectableFromTarget(target, selectables)` - DOM 树遍历，找到最近的可选元素

- **处理场景**：
  - 普通点击 → 替换选中
  - Shift + 点击 → 范围选中
  - Ctrl/Cmd + 点击 → 叠加选中或反选
  
- **解耦点**：无副作用，无状态，易于单元测试。

### 🟡 core/SelectionEngine.ts
**职责**：协调器，组装各模块。

- **职能**：
  - 初始化 `InputObserver`、`SelectionRenderer`、`SelectionStoreManager`
  - 监听 `InputObserver` 的事件，触发对应业务逻辑
  - 维护当前拖拽状态（`_areaLocation`、`_targetRect` 等）
  - 暴露公共 API（`select`、`deselect`、`cancel`、`destroy`）

- **事件流**：
  ```
  InputObserver.tap
      ↓
  SelectionStrategy.resolveClick (纯逻辑)
      ↓
  StoreManager.select/deselect (更新 Store)
      ↓
  emit('move'/'stop')
  ```

- **关键点**：
  - 代码简洁，逻辑线性化
  - 所有复杂决策已委托给 `SelectionStrategy`

### 🔴 core/SelectionRenderer.ts
**职责**：选框 DOM 创建与重绘。

- **功能**：
  - 创建/挂载/移除选框 DOM 元素
  - 根据拖拽坐标更新选框尺寸
  - 管理选框的显示/隐藏与样式

### 🟣 core/SelectionStoreManager.ts
**职责**：选中状态管理。

- **功能**：
  - 维护 `_selection` Store（selected/touched/changed）
  - 计算哪些元素应该被选中/取消
  - 触发 `beforechange`、`move` 等事件

### 📘 adapters/MindMapSelectionAdapter.ts
**职责**：与 MindMap 业务层对接。

- **功能**：
  - 创建 `SelectionEngine` 实例，传入 MindMap 配置
  - 使用 `filterTarget` 配置化地过滤不可选元素
  - 监听 `move`/`stop` 事件，更新 MindMap 的选中节点列表
  - 触发 `selectNodes`/`unselectNodes` 总线事件

- **解耦点**：
  - Selection 引擎完全不知道 MindMap 的存在
  - 业务逻辑（如更新 `mind.currentNodes`）全在 Adapter 中

- **宿主注入的关键规则**：
  - `suppressDragSelectionFromDownTarget(target)`：决定“某些起点元素的拖动”是否应抑制进入框选拖拽
  - 中文说明：
    - 典型场景：从 `mm-topic` 上开始拖动时，应该优先进入“节点拖拽”，而不是出现蓝色框选框
    - 该规则只影响 drag selection，不影响 tap（单击选择）
    - 该规则必须以 **down 阶段的真实起点** 为准（move 阶段 event.target 会漂移）

### 🎯 actions/nodeActions.ts
**职责**：对外暴露的公共 API。

- **功能**：
  - `select(target)` - 主动选中节点
  - `deselect(target)` - 主动取消选中

---

## 使用流程

### 初始化
```typescript
// 在 MindMapSelectionAdapter 中完成
const selection = new SelectionEngine({
  selectables: ['.map-container mm-topic'],
  boundaries: [mind.container],
  filterTarget: (target, event) => {
    // 业务级过滤（如忽略正在编辑的输入框）
    return !target.classList?.contains('svg-label-editor')
  },
  // ... 其他配置
})

selection.on('move', ({ store: { changed } }) => {
  // 处理选中变化
  mind.currentNodes = [...added]
})
```

### 生命周期
1. 用户按下鼠标 → `InputObserver.onDown` → 记录起始坐标
2. 移动鼠标超过阈值 → `InputObserver.onDelayedMove` → 触发 `start` 事件
3. Engine 接收 `start` → 显示选框、调用 `resolveSelectables`
4. 每帧 `move` → `SelectionStrategy` 计算碰撞、`StoreManager` 更新 Store
5. 释放鼠标 → `InputObserver.onUp` → 触发 `stop` 事件
6. 销毁时 → `selection.destroy()` → 清理监听器、移除 DOM

---

## 重构里程碑

- ✅ **Phase 1**（2025-11-22）：物理聚合 - 将 Selection 模块迁移到 `interaction/selection/`
- ✅ **Phase 2**（2025-11-22）：核心拆分 - 提取 `ScrollHandler`、`SelectionRenderer`
- ✅ **Phase 3**（2025-11-23）：业务解耦 - 使用 `filterTarget` 配置化 DOM 过滤
- ✅ **Phase 4**（2025-11-23）：消除上帝类 - 拆分 `InputObserver` + `SelectionStrategy`，移除 `SelectionInteractionHandler`

---

## 设计原则

1. **单一职责** - 每个类只负责一个维度（输入、逻辑、渲染、协调）
2. **无环依赖** - 单向依赖流：Input → Logic → Render → Coordinator
3. **可配置化** - 通过 `filterTarget`、`options` 等参数，支持业务级定制
4. **可测试** - `SelectionStrategy` 是纯函数，无需 DOM 即可单元测试
5. **解耦适配** - Adapter 层隔离业务逻辑，Selection 引擎完全独立

---

## 后续优化机会

- [ ] `ScrollHandler`：自动滚动逻辑是否可进一步拆分
- [ ] `SelectionRenderer`：支持自定义选框样式（Slot/Plugin）
- [ ] 性能：大量元素时的碰撞检测优化（四叉树/空间划分）
- [ ] 无障碍：添加 ARIA 属性支持键盘导航
