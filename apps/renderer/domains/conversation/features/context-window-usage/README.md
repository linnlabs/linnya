# Context Window Usage

本 feature 展示当前 Conversation 最近一次成功提交给模型的 Prompt 上下文占用。它只消费正式用户消息 read model，
不在 Renderer 估算草稿、不读取 telemetry / cost collector，也不维护第二份 token 状态。

## Owner 与数据流

Graph 每次成功 LLM Prompt 发布一条 ephemeral `context_usage_snapshot`；Host 在 execution 边界为它绑定正式
`user_message_id`，Renderer live projector 随即原子写入触发执行的用户消息。一次 Prompt 返回多个 tool calls 仍只有一条
快照，工具本身不补造 token 事件；工具完成后的下一次 LLM Prompt 成功时再更新。

execution settlement 最多发布一条 durable `run_execution_metrics.context_usage`，使用同一产品转换函数覆盖最终值，保证
reload 和断线客户端收敛。临时快照不进 EventStore、UI replay、Agent context 或 Graph history。
`useConversationSelectors` 提供 `window ∪ live` 合成消息和是否包含会话尾部；本 feature 的 orchestration 只把这些
响应式来源交给纯函数，并把派生结果提供给输入框 footer。没有 feature store，也没有跨 domain store 读取。

当前模型 ID 来自 model-configuration 的公开 purpose binding，仅用于判断 `historical_model`。后端以正式 inference route
作为理论窗口和最大输出基线，只有显式 Agent policy cap 才能进一步收窄；Renderer 只消费最终快照，不保存模型容量表，
也不为缺失快照补 256K/16K。

## 展示联合

| 状态 | 语义 |
|---|---|
| `unavailable` | 草稿会话或还没有成功快照；不渲染圆环入口 |
| `tail_unavailable` | 当前历史窗口不含会话尾部，不能证明窗口内快照是最新值 |
| `current` | 快照预算模型等于当前有效模型，且未超额 |
| `historical_model` | 当前模型已改变；旧快照保持原数字 |
| `overflow` | `used_tokens` 超过当次完整有效窗口，真实比例允许超过 100% |

正常、偏高、很高阈值分别为 `<70%`、`70%–<90%`、`90%–100%`。超额状态的圆环弧长封顶，但顶部比例与总量不做
clamp。正数小于 1% 显示为 `<1%`，避免伪装成 0%。

三段与三行固定为 System prompt、Tool definitions、Conversation。默认 Skills catalog 已由后端归入 System prompt；
`skill` 工具读取的资源随工具结果进入 Conversation。Renderer 不解析 Prompt XML，也不读取内部 component ledger
重新分类。

## UI 边界

`ContextWindowUsageDropdown.vue` 只负责连接 localization、用量内容、圆环与 anchored positioning。
`ContextWindowUsagePanel.vue` 由本 feature 私有拥有：当前只有 Context Window 使用它，且固定三种 tone 与颜色就是该
业务的分类语义，尚未形成跨业务稳定合同，因此不进入 `@linnya/renderer-ui`。它不自行绘制浮层 surface。
`BaseDropdown` 拥有点击外部、Escape 和焦点归还；Teleport 容器复用 `CustomSelect` 的标准 dropdown surface，本 feature
只提供面板 ref 与 viewport 位置计算。

面板的 token 模块只显示顶部占用摘要、分段条和三项构成，不显示 source、confidence、预算模型或输出预留脚注。顶部、圆环和占用条
统一使用 `input_budget_tokens + output_limit_tokens` 还原当次完整有效窗口；未着色尾部因此同时包含剩余输入空间和
输出额度。后端裁剪与 admission 仍只使用 `input_budget_tokens`，Renderer 不改变执行预算。
三项归因值统一使用紧凑 ASCII `~ ` 前缀标记近似值；分段条保持总占用宽度不变，并为每个非零组成保留最小可见
宽度，避免小占比被像素舍入吞掉。

面板底部通过共享组件的无标题详情区展示 Conversation 创建时间与用户消息数。创建时间来自当前 Conversation 实体；
用户消息数优先消费后端历史 metadata 保留在 Conversation read model / 历史列表中的 `user_message_count`，避免长对话
只统计当前消息窗口。新会话尚未取得历史 metadata 时，使用当前 live 投影中的 `user_input` 数量，metadata 到达后
自动切换到全量计数。

新对话和其它没有成功快照的会话不渲染圆环；第一次 LLM Prompt 成功并投影快照后自动出现。只有
`tail_unavailable` 仍保留空环与说明面板，因为它表达的是已有历史窗口不完整，而不是尚无数据。

圆环的未使用轨道消费 `--color-border-light` 并使用更细描边，已用弧线略粗且保留圆头；二者通过明度和线宽共同建立
层级。圆环视觉直径为 16px，按钮热区保持 24px；与发送按钮使用标准 `--spacing-sm` 间距，不为了视觉变轻缩小
可点击范围。

会话 ID 作为 dropdown component key，切换会话会关闭旧弹层。运行期间 footer 不禁用圆环：第一次成功 Prompt 前保留
上一份快照，之后每次成功 Prompt 到达即由同一 computed 自动刷新；最终 settlement 再覆盖为 durable 结算值。

## 测试边界

纯函数测试覆盖不可用、tail gate、最近快照、阈值、历史模型、overflow、格式化和定位。集成测试覆盖固定三行、无关闭
按钮、Teleport 面板内部点击与空态。共享 dropdown 独立覆盖点击外部和 Escape 焦点归还。不为 padding、颜色或 DOM
snapshot 写测试；视觉值由样式 token、style audit 与 Electron 验收负责。
