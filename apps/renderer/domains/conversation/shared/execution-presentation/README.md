# 执行活动展示

本模块是 Conversation 执行动画与状态文案的唯一 owner。普通工具、Subrun 标题、步骤、完整消息、详情底栏和插件工具卡共同使用这里的派生规则与 `ToolActivityIndicator`，不新增运行状态 store，也不修改 Runtime 或 durable message。

## 状态来源与边界

- `InteractiveRunSnapshot` 表达运行控制事实；按渲染 surface 的 `conversationId` 与消息 `run_id` 精确匹配。批注 run 通过同样的归属匹配读取自己的 store。
- `loading/success/error` 表达工具结果是否结算。`loading` 只表示尚无结果，不能单独触发动画。工具成功、失败保持自己的结果，父 run 结束不能把未结算工具变成成功。
- `isBusy` 表达输入占用；等待用户、重连、暂停收尾仍可能 busy，但不等于正在生成。主画布 active run、思考、摘要、步骤和工具展示使用派生的 `isExecuting`。
- 历史 trace、图片、文档等真实读取请求各自持有局部加载态；它们不属于 Agent 执行动画。

| 内部控制状态 | 用户可见状态 | 执行动画 |
| --- | --- | --- |
| running | 进行中（正文可用业务进度文案） | 开启 |
| pausing / paused / awaiting_user / cancelling | 已暂停 | 关闭 |
| starting / continuing / submitting / reconnecting | 进行中 | 关闭，不能把准备或对账当成实际生成 |
| completed / failed / cancelled / 无匹配运行 | AI 输出结束 | 关闭，保留工具自身的真实结果或错误 |

工具 header 只有两种显示：所属 run 正在执行时标题文字扫光；其它情况保留静态标题，不显示状态文字或标记。普通工具、Subrun 标题和执行中的步骤使用同一 `ExecutionProgressText` 扫光实现，header 不再额外放转圈。

输入框只显示暂停、恢复、发送。内部收口通过禁用对应按钮表达，不再显示转圈、waiting 或取消按钮。暂停未 settled 前恢复不可点击；审批必须在原表单提交，恢复按钮不能自动同意。现有只支持取消的输入扩展没有可用暂停能力，保持暂停按钮禁用，不把取消冒充暂停。

状态与文案由 `functions/resolveExecutionActivity.ts` 派生；Vue 只接线和展示。暂停/停止命令期间排队到达的旧进度不能撤销控制意图，这条转换由 interactive-run owner 负责。

## 注入与复用

`ToolCallsMessage` 从消息所属 run 派生活动态并提供工具上下文，按实际布局声明 header 是否已承载进度。有标题的普通卡片只在标题扫光，正文保留业务文案；无标题的卡片在原占位区域播放文字动效，避免同一工具的 header 与正文重复动画。子任务步骤是独立进度，仍按各自状态展示。

卡片只使用公共 `ToolActivityIndicator`，支持默认扫光 `shimmer`、问卷与 PPT 方案的文字呼吸 `pulse`、Skill 的静态文字 `none`；图片保留图片区域的占位布局。效果只决定表现，不能改变执行状态或自行判断是否继续动画。统一样式还负责遵守系统减少动态效果设置。需要标题扫光或步骤强调的 Host 组件读取同一 `useToolExecutionActivity`。缺少宿主上下文是装配错误，不用全局 active conversation 或默认 running 兜底。

Subrun 只有经显式 `conversationId + subrunId` 绑定才继承父调用活动态；每个 child 工具仍先遵守自己的结果状态。详情与插件公开 SubrunCard 都提供这条 scope，因此暂停与继续可传到完整 child 消息，不影响其它会话或历史 run。

插件通过 `@plugin/renderer/executionPresentation` 使用 `ToolActivityIndicator`，只贡献运行中的业务文案、布局与文字效果选择，不复制转圈或动画 keyframes。合同归 `packages/plugin-host-contract`，运行实现与样式留在本模块。

## 验证

业务回归覆盖真实父工具投影到虚拟行与完整 Subrun 详情：运行 → 暂停收尾 → 已暂停 → 继续，等待用户/重连/停止，跨会话隔离、已完成步骤不复活、消息事实保持未结算。Backend SQLite 测试确认可继续暂停允许 durable 工具仍为 loading；Electron projection-settlement 场景验证真实 DOM 的动画与静态状态切换。
