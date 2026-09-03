# TaskState Domain

TaskState 是对话执行空间中的结构化任务状态，不是 Workspace 文档，也不是 SharedMemory 资源。

## 稳定边界

- 作用域：当前 Conversation 的 admitted working history
- 业务事实：是否存在、快照、版本、创建或更新
- 事实来源：按 `run_id + tool_call_id + tool_name` 与此前 `tool_call_decision` 配对的成功 `task_write`

TaskState domain 不认识物理目录、数据库表、项目关系或 conversation instance，也不建立第二份当前状态。它只认识 `task_write` 这一正式 producer 工具合同；Conversation 与 Linnkit 仍只提供通用事件和 working-history 能力。

## 调用链

```text
Tool facade
  -> TaskState 参数 admission
  -> history-projection 选择最新配对事实并计算版本
  -> canonical tool result
  -> 既有 Conversation EventStore
```

`task_write` 通过 `createNextTaskStateSnapshot` 生成下一版，`task_read` 复用同一 history projector。编辑重发截断 working history 后，状态和版本随当前分支自然回退。

## 维护规则

- 命中的最新配对事实若合同损坏必须明确失败，不能跳回旧快照。
- `tool_call_id` 只在 run 内唯一；未路由事实和跨 run 的同值 id 都不能形成配对。
- 裸 output、失败 output、错配 call id、旧工具名和其它工具输出都不能制造新状态。
- live 结果不公开路由 identity、SharedMemory source、URI、文档 id 或路径。
- TaskState 的字段长度、数组数量和 8000 字符总预算由 `@app/schemas` 唯一约束；超限明确失败。
- 文件型 live reference 与 `read_file` 共用 `FileLocatorSchema`：只接纳显式 `workspace:/`、`conversation:/`、`file:///` locator；外部宿主文件使用 canonical `file:///`，不接纳裸绝对或相对路径。
- live references 不接纳已经退役的 SharedMemory / Evidence bundle / CitationSnapshot bundle URI。
- 历史工具结果的解释属于 Renderer replay，不进入 domain port。
- Subagent 不读取或写入父 Conversation TaskState；父子任务语义只通过 `subagent(prompt)` 交接。
