# Subrun Collection

## 1. 模块定位

`subrun-collection` 是 conversation 域内“一个父工具下有多个 subrun”的归一 feature。它有两个明确消费面：

- Host `SubrunBatchCollection.vue` 在父工具消息的统一 `ToolCallsMessage` 卡片内，将已接纳 batch presentation 映射为多个 `SubrunProgressCard` 薄适配器；每项的逐行过程继续由同一个 `SubrunTracePanel` 渲染。
- 插件公开 `SubrunCollection.vue` 继续组织多个完整 `SubrunCard`，并拥有其 bounded / 互斥展开交互。

两者共享已接纳的 collection item，但不共享 Host 导航状态。Host 详情归 `features/subrun-detail/`，本 feature 不拥有 `ConversationHost`、virtualizer 或滚动行为。

## 2. 输入与顺序

正式 adapter 只读取 `@app/schemas` 的 `SubrunBatchArgs`、`SubrunBatchStructuredResult`、conversation 投影的 `subrun_summary` 与父工具 presentation。

1. 工具完成后以 `data.subrun_ids` 为权威顺序。
2. 运行中以 args 显式 `subrun_id` 顺序排列已形成 summary 的项。
3. summary 有真实 ID 但 args 未声明时按到达顺序追加。
4. 禁止从 subrun ID 字符串、后缀、下标或父 tool call ID 猜顺序。

开发环境不接纳旧参数或 ID 推导合同。

## 3. 目录职责

| 路径 | 职责 |
|---|---|
| `definitions/` | collection item 与公开 UI 状态合同 |
| `functions/` | batch DTO 到标准 item 的纯映射 |
| `ui/SubrunBatchCollection.vue` | Host batch 工具卡 adapter，只组织复用 `SubrunTracePanel` 的父进度项 |
| `ui/SubrunCollection.vue` | 插件公开多卡容器，只在插件路径维护互斥展开 |
| `styles/` | collection 内相邻项布局 |

父 trace 历史、accumulator 与 step projection 归 `features/subrun-trace/`；完整 child message admission 与单卡展示归 `features/subrun-card/`。

## 4. 不变量

1. 一个父 batch 工具在主时间线只占一个 visual-row。
2. Host 路径不挂载完整 child messages，也不拥有 `activeSubrunId`。
3. 插件的 bounded / 互斥展开合同不得回流 Host。
4. 不解析 subrun ID 字符串，不从 raw result 猜身份。
5. 不复制每张卡各自加载历史 trace 或渲染逐行步骤的逻辑。
6. UI 只做展示与交互；顺序和状态映射保留在纯函数中。

## 5. 验收

- live 与 reload 保持同一组权威 ID、顺序与 trace 分桶。
- Host 真实 virtual row 只出现共用 `SubrunTracePanel` 的轻量进度，点击时通过窄 navigation port 传递精确 detail scope。
- 插件 collection 单独验证 bounded 与互斥展开，不以其代替 Host 端到端验收。
