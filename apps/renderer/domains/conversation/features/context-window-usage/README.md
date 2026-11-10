# Context Window Usage

本 feature 展示按当前模型和 Agent 估算的已保存上下文占用。打开对话时独立查询 `GET /api/v1/conversation/:id/context-usage`，
历史窗口可以先显示。查询与历史分页、滚动位置、可视行数无关。

## Owner 与数据流

Host 从 EventStore 读取前台正文事实，以 Linnkit 的正式上下文构建器做本地估算。它使用当前模型 route 和 Agent 工具目录，
复用上下文裁剪、图片预算和 tokenizer。不会调用模型、远程计数或执行有写入行为的请求增强器。分项与总量是估算值，
不计尚未发送的草稿、附件和临时本轮注入，也不预先执行历史压缩。

前端在切换对话、模型或 Agent 时取消旧请求。运行结束或持久化窗口 revision 变更后重新查询；空闲时观察当前对话，
使没有本窗口 SSE 的 CLI 工具运行也能更新用量。后端按会话持久化统计、Agent 与模型配置复用最近一次估算。
滚动读取历史不会清除有效值。当前运行已经发布成功 Prompt 快照时，只有同一 run 和预算模型的 live 值可临时覆盖估算。
历史快照仍是已发生 Prompt 的记录，不参与空闲时的当前用量。

## 展示联合

| 状态 | 语义 |
|---|---|
| `hidden` | 没有已保存会话，或没有可估算的模型 |
| `loading` | 正在估算。圆环中心以明暗变化提示进度，并支持系统减少动态效果设置 |
| `unavailable` | 本次估算未成功，可查看中性提示 |
| `current` | 当前用量已就绪 |
| `overflow` | 占用超过模型和 Agent 共同约束的有效窗口 |

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

圆环的未使用轨道消费 `--color-border-light` 并使用更细描边，已用弧线略粗且保留圆头；二者通过明度和线宽共同建立
层级。圆环视觉直径为 16px，按钮热区保持 24px；与发送按钮使用标准 `--spacing-sm` 间距，不为了视觉变轻缩小
可点击范围。

会话 ID 作为 dropdown component key，切换会话会关闭旧弹层。

## 测试边界

测试覆盖当前运行的快照归属、阈值和容量显示，以及真实历史查询在无旧快照、追加工具结果、切模型和截断后的变化。
集成测试验证加载提示和 Teleport 内点击，视觉以 Desktop 探针验收。
