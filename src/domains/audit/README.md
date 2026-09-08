# Linnya 统一审计模块

本目录是 Linnya 唯一的审计模块。它统一回答“谁在什么运行范围内做了什么决定，以及结果是什么”，并把所有可持久化审计事实送到同一条
`AuditPort` 链路。

Phase 0 的目标是收口入口和存储责任：

```text
Runtime / Command / LLM debug evidence
              │
              ▼
src/domains/audit/orchestration/createLinnyaAuditRuntime.ts
              │  等级过滤 + 按 action 统一路由
              ▼
       Linnya AuditPort（唯一写入入口）
              ├──────────────► EventStore 的隐藏 audit_envelope 事件
              │                         │
              │                         ▼
              │                 workspace.sqlite / CLI 只读导出
              └──────────────► Audit/v1/dev-diagnostics/*.jsonl
                                  （仅 debug，开发态，有界）
```

宿主进程启动时只组合一次
`createLinnyaAuditRuntime({ sink })`。它返回进程内唯一的 `AuditPort`。普通决策事实
使用 Linnkit 的 EventStore audit port，最终写入当前 workspace 的 `workspace.sqlite`，事件类型为
`audit_envelope`，可见性为 `none`，不会进入 UI、Agent 上下文或 SSE。`llm.*`
大体积 debug evidence 仍从同一个 `AuditPort` 进入，但由 Audit Domain 写入有界的
JSONL 目录，避免把上下文全文塞进 EventStore。没有完成主进程组合时，测试运行时使用内存
EventStore；这不是另一种生产存储。

数据库文件路径由 `getWorkspaceDataPath()` 统一决定，而不是由 Audit 自己拼接：

| 运行域                         | `workspace.sqlite`                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| 开发（`LINNYA_DEV_MODE=true`） | `<repoRoot>/_dev_data/workspace/workspace.sqlite`                                     |
| macOS 生产                     | `~/Documents/Linnya/workspace/workspace.sqlite`（由 Desktop Host 的用户文档目录决定） |
| Windows 生产                   | `%USERPROFILE%/Documents/Linnya/workspace/workspace.sqlite`                           |

如果宿主安装了自定义 Workspace
Root，表中的根目录随宿主解析结果变化。Audit 不拥有路径解析，也不在
`Documents/LLMRunAudit`、AppData 日志目录或独立数据库中写副本。开发 debug evidence
的路径固定为 `<workspaceRoot>/Audit/v1/dev-diagnostics/<conversationId>/<runId>.jsonl`；
文件名中的身份经过路径段清理。

## 审计等级

统一开关是 `LINNYA_AUDIT_LEVEL`，可选值如下：

| 等级       | 记录内容                                                                          | 适用场景                   |
| ---------- | --------------------------------------------------------------------------------- | -------------------------- |
| `minimal`  | 安全和关键生命周期事实，例如 command、run、工具允许/拒绝、等待用户和 sandbox 决定 | 低噪声运行、容量紧张的环境 |
| `standard` | 所有已经通过安全投影的 Runtime/Command durable audit；默认值                      | 日常开发和生产             |
| `debug`    | `standard` 加 LLM context、transcript、输入物化证据和工具协议错误；这些 `llm.*` 证据写入有界 JSONL | 只用于开发问题定位         |

`debug` 只有在 `LINNYA_DEV_MODE=true` 时有效；生产进程即使误设置也会降级为
`standard`。未知值和空值也回到 `standard`。旧的 `LINNYA_LLM_RUN_AUDIT`
及其容量环境变量不再是配置入口。

等级只决定记录哪些事实，不改变入口。所有等级都经过同一个
`AuditPort`，所有事件都使用 `AuditEnvelope`，并且只能追加，不能更新或删除单条审计信封。
Audit Domain 内部可以按事实体量选择 EventStore 或有界 debug 文件，这是存储类别，不是第二套
审计入口或第二个配置开关。

## 不同概念的边界

只有下面这条链路叫 Audit：`AuditEnvelope → audit_envelope → EventStore`。

| 现象                             | owner                     | 是否是审计                                                   |
| -------------------------------- | ------------------------- | ------------------------------------------------------------ |
| `linnya audit` CLI               | `execution-audit-export`  | 否。它只读取统一审计、RunRegistry 和 Telemetry，生成安全摘要 |
| Backend 日志                     | logging                   | 否。用于诊断，不是事实源                                     |
| `engine_telemetry`               | Telemetry                 | 否。用于统计和性能分析，有自己的保留周期                     |
| checkpoint                       | runtime / recovery        | 否。用于恢复中断执行                                         |
| Document History                 | conversation/history      | 否。用于内容历史和用户可见回滚                               |
| Provider outbound latest attempt | provider diagnostics      | 否。当前是进程内最新快照，不落库，不得被称为第二套审计       |
| `audit_envelope`                 | Audit Domain + EventStore | 是。唯一 durable audit 事实源                                |

因此，CLI 的 `audit`
命令不能写文件、写数据库或启动另一种 recorder。未来如果需要新的审计事实，应增加新的
`action` 和安全投影，继续调用当前 `AuditPort`。

## 如何使用

应用组装只在主进程完成：

```ts
const auditRuntime = createLinnyaAuditRuntime({
  sink: audit.createEventStoreAudit({ eventStore }),
});

const runtimeScope = {
  auditPort: auditRuntime.auditPort,
  // supervisor 等其他 runtime 依赖也复用这个 port
};
```

业务代码不允许直接构造 EventStore audit sink，不允许直接写
`workspace.sqlite`，也不允许从 `features/llm-debug-evidence`
的内部目录导入。需要审计时：

1. Runtime 或 Command 通过注入的 `AuditPort` 发出 `AuditEnvelope`。
2. LLM debug evidence 通过 `src/domains/audit` 的上下文函数记录；它只在 `debug`
   等级工作，存储路由由同一个 Audit Runtime 决定。
3. CLI 和查询 use case 只读取 EventStore / RunRegistry /
   Telemetry 的公开查询能力。

LLM debug evidence 使用 AsyncLocalStorage 关联 conversation、run、trace、subrun 和父工具调用。
它会经过 Linnkit 的 durable projection，拒绝图片二进制、provider transient 字段和其他不能长期保存的对象；
单片段超过 512 KiB、单次 run 超过 256 个 debug 片段、单次 run 超过 16 个工具协议错误或 16 个 system
reminder 片段时停止继续记录。文件 sink 另外限制单个 run 文件 16 MiB、debug 目录 256 MiB、保留 7 天。
审计写入失败只记录诊断日志，不覆盖正常业务结果。

## 新增审计事件的规范

新增 action 前必须先说明它对应的业务事实、actor、scope、decision 和 evidence。实现必须满足：

- 在 Audit Domain 或明确的 domain
  feature 中定义，不在 CLI、route、store 或 provider adapter 里另起 recorder。
- 使用 `AuditEnvelope.parse` 校验合同；`runId`、`conversationId` 和 `turnId`
  必须来自真实运行上下文。
- evidence 只放为后续调查所需的最小字段；禁止保存凭据、完整环境变量、完整 stdout/stderr、provider
  raw request、图片 bytes 和无限增长的 transcript 副本。
- 明确该 action 属于哪个等级；`minimal`
  的事实必须使用已登记的安全前缀，其他事实默认在 `standard` 保留。
- 对容量、失败语义、删除语义和 CLI 查询方式补充测试与文档。
- 不把日志、Telemetry、checkpoint 或内容历史的职责迁移到 Audit。

## 生命周期、删除和膨胀控制

审计事件与普通 RuntimeEvent 共享当前 workspace 的 `workspace.sqlite`
和 run/conversation 归属。删除对话时，EventStore 的 conversation facts
cleanup 会一起删除该对话的审计事件；从历史截断时，属于被截断 run 的事件也按同一事实源规则处理。内存 sink 只用于测试，不需要清理磁盘。

Phase 0 不再创建 `<Documents>/LLMRunAudit/` 文件、`.in_progress` checkpoint 文件或
旧的每类 JSON 审计副本。开发 debug evidence 只写入版本化的
`<workspaceRoot>/Audit/v1/dev-diagnostics/`，由统一 Audit Domain 负责容量和 TTL。开发阶段和生产阶段的区别由
`LINNYA_DEV_MODE` 与 `LINNYA_AUDIT_LEVEL` 控制：生产保持
`standard`，开发排障才临时使用 `debug`。由于 `debug` 仍然是 durable
审计入口产生的事实，排障完成后应恢复 `standard`；它的上下文文件按 7 天 TTL 和目录上限清理。
目前文件 sink 在启动首次写入和后续写入时维护这些限制，长期 Runtime 仍需把它注册到统一 maintenance
调度器，不能只依赖“下一次有 debug 写入”。

当前不应把 `workspace.sqlite`
中的审计行当作永久无限保留。durable 审计随 conversation/run 事实删除；按时间清理 durable
审计仍需单独的 retention 决策，不能为了控体积直接删除用户运行事实。debug 文件由 Audit Domain
按 7 天 TTL、单 run 16 MiB、目录 256 MiB 管理。旧 `<Documents>/LLMRunAudit/` 目录不会被自动静默删除，
避免升级时丢失开发证据；确认不再需要后可手工删除旧目录。

当前的清理操作按下面的规则执行：

- 开发排障结束后把 `LINNYA_AUDIT_LEVEL` 恢复为 `standard`；下一次 debug 写入会先清理过期文件，正常写入也会持续执行目录上限维护。
- 需要立即释放开发诊断空间时，先停止 Linnya，再删除当前 Workspace Root 下的 `Audit/v1/dev-diagnostics/`；这不会删除 `workspace.sqlite` 或用户文档。
- 生产环境不接受 `debug`，因此不会新建 debug evidence 目录；生产 durable 审计通过现有 conversation 删除流程随事实删除。
- 当前 CLI 的 `audit` 是只读摘要，没有“清空审计”命令。不要直接删除 `workspace.sqlite`，也不要通过 CLI 另造清理路径。

## 开发和验证

修改本模块后至少验证：

- `resolveAuditLevel` 的默认值、非法值、生产 debug 降级；
- `minimal` 对 action 的过滤，`standard` 的完整安全事实保留；
- LLM debug evidence 只经统一 sink 写入，并在 flush 后可查询；
- 图片 transient、超大证据和协议错误上限按规范丢弃；
- CLI 仍是只读投影；
- 对话删除或历史截断不会留下脱离 conversation/run 的审计事实。

审计模块的坏味道包括：出现新的 `audit*.json` 目录、新的审计环境变量、直接调用
`createFileAudit`、在 store 内拼接信封、把日志叫成审计，或让一个 feature 自己决定 retention。发现这些情况应先修正边界，再继续扩展功能。
