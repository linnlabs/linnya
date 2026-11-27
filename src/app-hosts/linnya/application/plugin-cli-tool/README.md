# plugin_cli 工具运行时

## 职责

外部 Agent 通过 `linnya tools call plugin_cli` 运行已启用插件自己的命令，不调用 Linnya 的模型。
本 use case 是 `plugin_cli` 工具（`src/tools/commands/plugin_cli`）背后的窄端口
`PluginCliToolRuntimePort`：它在会话工作目录准入内调用
[共享执行规则](../plugin-cli-shell-bridge/README.md#共享执行规则)，不另写一套插件命令执行。

```text
linnya tools call plugin_cli
  -> conversation-control：无模型 Flow 运行（host_tool_call）
  -> ToolNode -> PluginCliTool
  -> PluginCliToolRuntimePort.invoke
  -> 会话工作目录准入 -> invokePluginCliContribution -> 插件 prepare / execute
```

## 身份与权限

- 会话、运行与工具调用身份来自本次 ToolContext，不读取 argv 或调用方自报值；invocation ID 以工具调用 ID 为前缀。
- 权限取根运行启动时冻结的 `CommandRunPermissionSnapshotV1`：`internal_data_access` 决定能否读写内部数据，
  `permission_level` 为只读时拒绝写文件或写内部数据的命令。这个入口没有审批环节；只有人能批准的规则不因外部调用方放宽。
- Host 推理固定不可用：声明 `hostInference` 的命令以 `permission_denied` 拒绝，说明改由 Linnya Agent 在 Shell 里运行。

## 会话目录与本机路径

插件在 `withAdmission` 内执行，截图、导出等写入期间会话删除流程会等它结束。插件把产物报告成
`conversation:/` 定位符；工具结果（`PluginCliToolResultDataSchema`，见 `@app/schemas`）只含插件 ID、argv、
退出码、stdout 与 stderr，不含会话目录或任何本机绝对路径，因为它会写进事件并投影到界面。
本机路径只由 conversation-control 在 `tools call` 回执的 `conversation_directory` 里给命令行调用方，
`linnya` CLI 再据此列出 `conversation_files`。

## 失败

- 已知结果（插件不可用、权限拒绝、取消、输出超限）原样返回稳定 code 与退出码；工具把它们和插件的非 0 退出都变成工具 error。
- 未知异常经 `PluginCliToolDiagnosticPort` 在宿主日志记录关联号、阶段、身份与真实异常，工具结果只给关联号与退出码 70。

## 测试

`__tests__/pluginCliTool.integration.test.ts` 用真实插件注册表与会话目录准入覆盖：准入内执行且结果不带本机路径、
内部数据关闭与只读档位在 execute 前拒绝、声明推理的命令拒绝、非 0 退出与未知插件、未知异常只回关联号、取消、
参数在准入前校验。
