# Command Process Owner

## 1. 责任

`process-owner` 是 App Host 内唯一的 command execution ownership 层。它把一个业务 execution 绑定到一个 prepared runtime、活动 Agent run 和 conversation scope，并负责 reservation、控制动作、终态 replay、owner end 和删除收口。

它不创建 macOS 进程组或 Windows Job，不解析风险命令，不保存完整 stdout/stderr。平台资源由 runner runtime 持有，规则由 Commands domain 持有，输出由 output adapter 持有。

## 2. 目录与主要文件

```text
process-owner/
├── definitions/
│   ├── commandAgentRunLifecycle.ts       # Agent run 的 open/stopping/ended
│   ├── localCommandExecutionEntry.ts     # owner 内部 entry
│   └── localCommandExecutionOwnerError.ts
├── functions/
│   ├── createLocalCommandExecutionEntry.ts
│   ├── createLocalCommandTerminalReplayRegistry.ts
│   └── resolveLocalCommandProcessTarget.ts
├── orchestration/
│   ├── createLocalCommandExecutionOwner.ts
│   ├── controlLocalCommandProcessInteraction.ts
│   ├── createCommandAgentRunLifecycle.ts
│   └── submitProtectedLocalCommandInput.ts
└── __tests__/
```

`createLocalCommandExecutionOwner.ts` 较大，但它是 ownership 状态机的组合根。修改前先确认是否能把纯状态转换下沉到 `functions/`，不要在里面再加入 UI、授权或平台判断。

## 3. 身份和 handle

对外只给 opaque process handle。解析顺序必须是 scope-first：先用当前 conversation 和 Agent run 限定候选，再校验 `execution_id`、owner generation、生命周期状态，最后才查 entry。这样即使模型猜到另一个对话的 handle，也不会先触碰全局对象。

内部 entry 至少关联：

```text
conversation_id
root_agent_run_id
execution_id
owner_generation
mode = pipe | pty
prepared_runtime
state
created_at
```

PID、Job、PGID、Utility generation 和内部路径不进入 Agent observation 或 Renderer DTO。

## 4. 状态机

```text
reserved
  └─ approval settled → prepared
prepared
  └─ claimAndStart → running
running
  ├─ poll/wait → running snapshot
  ├─ cancel / owner end / hard timeout → stopping
  └─ runner terminal → draining
draining
  └─ output settled + tree empty + resource released → completed
```

“child exit”只是五个终态事实中的一个，不能直接变成 completed。对外 terminal 至少要区分 process exit、output drain、tree cleanup 和 resource release；runtime failure 只能由 host/runner 合法地产生。

## 5. 启动竞态

1. `reserve` 只写内存 entry，不创建 OS 资源。
2. 上层完成 admission、授权和必要的审批记忆后调用 `prepare`。
3. `claimAndStart` 一次性检查 owner generation、conversation admission 和 entry 状态，然后安装 runtime observers 并允许 spawn。
4. claim 之后的任何失败都必须带着“是否已经启动”的事实返回，不能把已启动的进程伪装成未启动。

删除屏障建立后，新的 reserve/claim/control/publish 都拒绝。迟到消息按 generation 和 entry 状态丢弃，但要保留可诊断的原因。

## 6. 输出与 replay

owner 只保存小型 observation cursor、状态和 terminal projection；完整输出交给 ToolOutputStore/raw artifact。replay 是非消费式的，多个 `process poll` 可以读取相同区间，不会因为一个 Agent 读过就让 Renderer 丢数据。

所有 replay/tombstone 结构都要有界。新增 Set/Map 时必须说明上限、淘汰时机和对话结束清理，否则长对话会把“修复重复监听”变成新的内存泄漏。

## 7. 控制动作

`process` 控制请求先校验 scope 和 execution，再根据模式选择：

- `poll`：读取观察快照，不改变输出游标。
- `wait`：等待 terminal 或指定超时，超时本身不是取消。
- `cancel`：请求停止并等待平台 owner 收口。
- PTY `write`/`submit`/`eof`/`resize`：只对 `mode = pty` 有效，输入 byte 有上限，尺寸要经过预算校验。

保护输入走独立的主进程通道，不把密码正文放进模型可见参数或审计正文。

## 8. 对话和 App 关闭

`endAgentRun` 先标记 stopping，再停止对应整棵进程树，等待输出 drain 和 durable settlement。App 关闭、对话删除和精准清理都必须调用 owner 的窄接口，不能直接拿内部 entry。

## 9. 测试门禁

必须覆盖 reservation 与 approval 竞态、双重 claim、跨对话 handle、cancel/wait 并发、root run 结束、删除屏障、迟到 terminal、重复 terminal、replay 上限和长会话清理。测试要穿过真实 owner + runtime 组合；只 mock `ChildProcess` 不能证明 ownership 合同。
