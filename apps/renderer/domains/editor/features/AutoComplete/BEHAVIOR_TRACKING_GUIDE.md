# 用户行为追踪与意图预测 - 使用指南

本文档说明如何使用和测试新实现的用户行为追踪与意图预测功能。

## 功能概述

已完成功能：

- ✅ **阶段 A：行为追踪基础设施**
  - BehaviorTracker 服务：记录用户编辑行为（插入、删除、粘贴、选区移动、接受建议）
  - 集成到 Autocomplete 扩展中，自动追踪所有编辑事件
  - 自动过期清理机制（60 秒窗口）

- ✅ **阶段 B：规则版意图预测**
  - FeatureExtractor：提取节奏特征、操作分布特征、结构编辑特征
  - IntentPredictor：基于规则预测用户意图（7 种意图类型）
  - 集成到 TriggerManager 中，影响补全触发决策

## 意图类型说明

系统可以识别以下 5 种用户意图：

| 意图类型 | 描述 | 触发策略 |
|---------|------|---------|
| `list_next_item` | 继续列点（刚输入 `-`、`*`、`1.` 等） | ✅ 触发，中等长度 + 约束 |
| `continue_paragraph` | 正常续写段落 | ✅ 触发，中等长度 |
| `bridge_to_suffix_delimiter` | 收束并衔接到后缀分隔符（如 `---`） | ✅ 触发，短补全 + 特殊约束 |
| `rewrite_after_large_delete` | 大删后重写（100-300 字符） | ✅ 触发，短补全 + 2 秒冷却 |
| `structure_editing` | 结构调整（极大段删除 >300 字符） | ❌ 不触发 + 3 秒冷却 |

## 启用调试模式

在浏览器控制台中执行以下命令来启用调试模式：

```javascript
// 获取编辑器实例
const editor = window.__editor__ // 或者你的编辑器实例变量

// 启用行为追踪器调试
const behaviorTracker = editor.storage.autocomplete.behaviorTracker
behaviorTracker.debugPrintSummary() // 打印统计摘要
behaviorTracker.debugPrintEvents(20) // 打印最近 20 个事件

// 启用意图预测器调试
const triggerManager = editor.storage.autocomplete.triggerManager
triggerManager.enableIntentDebug(true) // 启用调试输出
```

## 测试场景

### 场景 1：正常续写（continue_paragraph）

**操作**：
1. 在编辑器中输入一些文本
2. 停止输入，等待补全

**预期行为**：
- 意图识别为 `continue_paragraph`
- 触发中等长度补全（2-3 句话）

**验证**：
```javascript
const prediction = triggerManager.getIntentPredictor().predict(
  behaviorTracker,
  editor.state,
  0
)
console.log('Intent:', prediction.intent) // 应该是 'continue_paragraph'
console.log('Confidence:', prediction.confidence)
```

---

### 场景 2：大段删除后重写（rewrite_after_large_delete）

**操作**：
1. 输入一大段文本（超过 100 字符）
2. 全选并删除
3. 暂停 500ms 以上
4. 开始重新输入

**预期行为**：
- 意图识别为 `rewrite_after_large_delete`
- 触发短补全（1 句话）
- 额外 2 秒冷却时间
- 补全会更保守

**验证**：
```javascript
behaviorTracker.debugPrintSummary()
// 检查 deletedChars 是否 > 100

const prediction = triggerManager.getIntentPredictor().predict(
  behaviorTracker,
  editor.state,
  0
)
console.log('Intent:', prediction.intent) // 应该是 'rewrite_after_large_delete'
console.log('Policy:', prediction.policy)
// shouldTrigger: true
// suggestedLength: 1
// additionalCooldownMs: 2000
```

---

### 场景 3：结构编辑（structure_editing）

**操作**：
1. 输入或选中超过 300 字符的大段文本
2. 全部删除（极大段删除）

**预期行为**：
- 意图识别为 `structure_editing`
- **不触发补全**（用户可能在重构整个结构）
- 额外 3 秒冷却时间

**注意**：输入列表标记（`- ` 或 `1.`）**不会**触发此意图，而是触发 `list_next_item`

**验证**：
```javascript
const prediction = triggerManager.getIntentPredictor().predict(
  behaviorTracker,
  editor.state,
  0
)
console.log('Intent:', prediction.intent) // 应该是 'structure_editing'
console.log('Should trigger:', prediction.policy.shouldTrigger) // false
```

---

### 场景 3.5：列表标记输入（list_next_item）

**操作**：
1. 输入列表标记：`- ` 或 `* ` 或 `1. `
2. 等待触发

**预期行为**：
- 意图识别为 `list_next_item`
- ✅ **应该触发补全**（帮助生成列表项内容）
- 中等长度补全
- 约束：自然延续列表项

**验证**：
```javascript
const prediction = triggerManager.getIntentPredictor().predict(
  behaviorTracker,
  editor.state,
  0
)
console.log('Intent:', prediction.intent) // 应该是 'list_next_item'
console.log('Should trigger:', prediction.policy.shouldTrigger) // true
console.log('Constraints:', prediction.policy.constraints) // ['Continue the list item naturally']
```

---

### 场景 4：收束到后缀分隔符（bridge_to_suffix_delimiter）

**操作**：
1. 输入一些文本
2. 在文本末尾按 Enter 两次
3. 输入分隔符 `---` 或 `###`
4. 将光标移回到分隔符之前
5. 继续输入

**预期行为**：
- 意图识别为 `bridge_to_suffix_delimiter`
- 触发短补全
- 补全会平滑过渡到后缀分隔符

**验证**：
```javascript
const prediction = triggerManager.getIntentPredictor().predict(
  behaviorTracker,
  editor.state,
  0
)
console.log('Intent:', prediction.intent) // 应该是 'bridge_to_suffix_delimiter'
console.log('Constraints:', prediction.policy.constraints)
// ['Output must smoothly transition to the delimiter', ...]
```

---

## 调试工具

### 1. 查看行为统计

```javascript
const tracker = editor.storage.autocomplete.behaviorTracker
tracker.debugPrintSummary() // 打印统计摘要
```

输出示例：
```
📊 Behavior Tracker Summary
Total events: 42
Event counts: {insert: 35, delete: 5, paste: 1, selection_move: 1, ...}
Inserted chars: 420
Deleted chars: 58
Last event: 10:30:45 AM
Window: {start: 10:29:45 AM, end: 10:30:45 AM}
```

### 2. 查看最近事件

```javascript
tracker.debugPrintEvents(10) // 打印最近 10 个事件
```

输出示例：
```
📝 Recent 10 Events
1. [10:30:42 AM] insert (45-46, Δ1) "a"
2. [10:30:43 AM] insert (46-47, Δ1) "b"
3. [10:30:44 AM] delete (46-47, Δ-1)
4. [10:30:45 AM] selection_move (45-47, Δ0)
...
```

### 3. 手动测试意图预测

```javascript
const tracker = editor.storage.autocomplete.behaviorTracker
const predictor = editor.storage.autocomplete.triggerManager.getIntentPredictor()

// 启用调试模式
predictor.enableDebug(true)

// 手动预测
const prediction = predictor.predict(tracker, editor.state, 0)
console.log('Prediction:', prediction)
```

输出示例：
```javascript
{
  intent: 'continue_paragraph',
  confidence: 0.7,
  policy: {
    shouldTrigger: true,
    suggestedLength: 2
  },
  debugInfo: 'Continue paragraph (default): typingSpeed=2.35 cps'
}
```

---

## 性能监控

### 检查事件数量

```javascript
const tracker = editor.storage.autocomplete.behaviorTracker
console.log('Event count:', tracker.getEventCount())
// 应该 <= 100（maxEvents 限制）
```

### 检查内存占用

```javascript
const events = tracker.getRecentEvents()
const avgEventSize = JSON.stringify(events).length / events.length
console.log('Average event size:', avgEventSize, 'bytes')
console.log('Total size:', avgEventSize * events.length, 'bytes')
```

---

## 已知限制

1. **粘贴检测不够精确**：目前根据插入字符数（>10）判断是否是粘贴，可能误判
2. **撤销/重做未实现**：目前无法追踪 undo/redo 操作
3. **事件来源识别不完整**：selection_move 无法区分 keyboard/mouse
4. **意图规则可能需要调优**：基于假设的阈值，可能需要根据实际使用调整

---

## 下一步（阶段 C & D）

- [ ] **阶段 C**：意图透传到后端（扩展 API 参数）
- [ ] **阶段 D**：模型化意图预测（可选，基于轻量分类模型）

---

## 常见问题

### Q: 如何禁用意图预测？

A: 目前没有单独的开关，但可以通过不传递 `behaviorTracker` 给 `TriggerManager` 来禁用：

```javascript
// 在 Autocomplete.js 的 addStorage() 中
const triggerManager = new AutocompleteTriggerManager(
  DEFAULT_DEBOUNCE_MS,
  aiSettingsStore
  // 不传递 behaviorTracker
);
```

### Q: 如何调整意图预测的阈值？

A: 修改 `IntentPredictor` 构造函数的配置：

```javascript
const predictor = new IntentPredictor({
  rewriteCooldownMs: 3000,    // 增加大删后冷却时间
  structureCooldownMs: 5000,  // 增加结构编辑冷却时间
  enableDebug: true,          // 启用调试
})
```

### Q: 行为追踪会影响性能吗？

A: 影响很小。每个事件只记录约 100-200 字节，最多保留 100 个事件，总内存占用 < 20KB。自动清理机制每 10 秒运行一次。

---

最后更新：2026-01-05
