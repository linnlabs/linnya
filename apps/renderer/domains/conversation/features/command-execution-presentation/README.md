# Command Execution Presentation

## 1. 目标

这个 feature 把后端稳定的 command presentation facts 投影为对话中的命令卡片。它不创建进程、不读取 raw artifact、不解析风险规则，也不决定命令是否完成。

## 2. 文件和责任

```text
command-execution-presentation/
├── definitions/commandExecutionPresentation.ts
├── functions/
│   ├── aggregateCommandExecutionMessages.ts
│   ├── projectCommandExecutionPresentation.ts
│   ├── projectCommandExecutionDetails.ts
│   └── applyCommandCardSettlement.ts
├── store/ (由对话 presentation 管理)
├── ui/CommandExecutionCard.vue
└── CommandExecutionCard.css
```

`project...` 负责把稳定事实变成 Renderer 类型；`aggregate...` 负责将同一个 tool call 的 started/observation/terminal 合并；Vue 组件只展示和调用 control gateway。

## 3. 卡片产品合同

- 运行中标题使用“正在运行 …”，完成后使用“已运行 …”；命令过长由后端提供安全摘要，UI 不自行截断 shell 语义。
- 终端小窗口只显示 text projection 或 PTY screen projection；不把 ANSI、HTML、SVG 或 artifact 路径直接插入 DOM。
- 完成状态、耗时、复制按钮位于卡片底部；退出码是内部事实，不作为主视觉字段，但可在需要诊断的详情中展示。
- 复制动作组合命令和当前可读取的输出正文，失败时显示普通错误，不改变执行终态。
- Shell / Process 卡从运行开始就默认折叠，拒绝或运行失败也不自动展开；用户可随时手动展开查看实时或 durable 输出。
- `status=error` 是工具执行层失败，不等同于 command result 中的 `rejected` 或 terminal
  `runtime_failure`。projector 只从参数投影 `failed` 生命周期事实，不得解析仅成功时存在的
  `ShellToolStructuredResult` / `ProcessToolStructuredResult`；具体错误继续由通用 ToolErrorCard 展示。
- 失败的 `process` 控制调用必须保留为独立错误消息，不能聚合进原 Shell 卡片后被吞掉。

## 4. 四层输出不能混合

1. raw byte artifact 是证据和恢复源。
2. Agent text 是模型观察，可能只有 head/tail 和 `tool_output://` 引用。
3. command card 是用户界面的短摘要和状态。
4. PTY screen 是终端屏幕的结构化 projection。

组件只能消费第 3、4 层。不能为了复制按钮或“看起来完整”而读取第 1 层并在 Renderer 拼接。

## 5. PTY 和控制

卡片中的 cancel、write、submit、eof、resize 都通过 control host 使用 opaque ticket。Renderer 不传 PID、Job、PGID 或 runner generation。resize 失败不能污染后续 projection 链；收到 tree-empty 后不再向 native PTY 发送输入。

## 6. 测试门禁

重点覆盖 presentation facts 的进行中/完成/拒绝/运行时失败投影、外层工具失败的 live/reload 同源、消息合并、复制内容、PTY 屏幕 allowlist、durable card 恢复和控制动作错误。不要把字体、颜色、间距、折叠动画写成脆弱的视觉快照测试。
