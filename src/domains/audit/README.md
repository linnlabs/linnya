# Linnya 统一审计模块

本目录是 Linnya 唯一的审计模块。它统一回答“谁在什么运行范围内做了什么决定，以及结果是什么”，并把所有可持久化审计事实送到同一条
`AuditPort` 链路。

Phase 0 的目标是收口入口和存储责任：

```text
Runtime / Command / LLM response or stream evidence
              │
              ▼
src/domains/audit/orchestration/createLinnyaAuditRuntime.ts
              │  等级过滤 + 按 action 统一路由
              ▼
       Linnya AuditPort（唯一写入入口）
              └──────────────► EventStore 的隐藏 audit_envelope 事件
                                        │
                                        ▼
                                workspace.sqlite / CLI 只读导出
```

宿主进程启动时只组合一次
`createLinnyaAuditRuntime({ sink })`。它返回进程内唯一的 `AuditPort`。普通决策事实
使用 Linnkit 的 EventStore audit port，最终写入当前 workspace 的 `workspace.sqlite`，事件类型为
`audit_envelope`，可见性为 `none`，不会进入 UI、Agent 上下文或 SSE。LLM response/stream
evidence 也从同一个 `AuditPort` 进入当前数据库 sink；高体积证据在写入前执行字段投影、
单片段和单 run 字节上限。没有完成主进程组合时，测试运行时使用内存 EventStore；这不是
另一种生产存储。

数据库文件路径由 `getWorkspaceDataPath()` 统一决定，而不是由 Audit 自己拼接：

| 运行域                         | `workspace.sqlite`                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| 开发（`LINNYA_DEV_MODE=true`） | `<repoRoot>/_dev_data/workspace/workspace.sqlite`                                     |
| macOS 生产                     | `~/Documents/Linnya/workspace/workspace.sqlite`（由 Desktop Host 的用户文档目录决定） |
| Windows 生产                   | `%USERPROFILE%/Documents/Linnya/workspace/workspace.sqlite`                           |

如果宿主安装了自定义 Workspace
Root，表中的根目录随宿主解析结果变化。Audit 不拥有路径解析，也不在
`Documents/LLMRunAudit`、AppData 日志目录或独立数据库中写副本。审计不再创建
`Audit/v1/dev-diagnostics/*.jsonl` 或其他独立文件型正式事实。日志仍由 logging owner 写入
独立的 console/file sink，但不属于 Audit。

## 审计等级和环境策略

统一开关是 `LINNYA_AUDIT_LEVEL`，可选值如下：

| 等级       | 记录内容                                                                 | 适用场景                   |
| ---------- | ------------------------------------------------------------------------ | -------------------------- |
| `off`      | 不写 Agent Run Audit；普通运行状态和独立日志不受影响                     | 生产固定值；测试可显式使用 |
| `behavior` | Agent/run 身份、生命周期、工具/命令行为、授权/拒绝、安全决策和终态       | 开发低体积排障             |
| `response` | `behavior` 加上游响应摘要、usage、结束原因和错误分类，不保存完整正文     | 开发显式开启               |
| `stream`   | `response` 加有界 canonical 流式 delta/chunk、上下文和协议诊断           | 仅开发诊断会话             |

开发进程默认 `off`；必须通过 `.env.local` 或开发启动环境显式设置
`LINNYA_AUDIT_LEVEL=behavior|response|stream`。生产 Host 根据已验证的 packaged 运行身份固定为
`off`，忽略审计环境变量，不能通过 `LINNYA_DEV_MODE`、CLI 或 HTTP 控制面绕过。未知值和空值回到
当前环境的安全默认值。旧的 `LINNYA_LLM_RUN_AUDIT` 及其容量环境变量不再是配置入口。

等级只决定记录哪些事实，不改变入口。所有等级都经过同一个 `AuditPort`，所有事件都使用
`AuditEnvelope`，并且只能追加，不能更新或删除单条审计信封。正式 Audit 只有一个数据库存储
类别；高等级不再通过 JSONL 形成第二套正式存储。

Host inference orchestration 会在真实 Provider attempt 到达成功或失败终态时生成
`llm.response.succeeded|failed` 摘要，内容只包含 route identity、finish/failure 分类和安全 token
聚合。归属来自当前 Audit run scope；Provider diagnostics 仍是独立的进程内 latest snapshot，
Provider domain 不依赖 Audit，也不会把 provider raw response 写入审计。
首批 producer 只覆盖 Agent 使用的 language generation canonical inference；Embedding、Reranking
和 Image Generation 在具备稳定 Agent run scope 与各自安全投影前继续只由原 owner 观测，不能伪造
归属或直接复制 Provider 响应进入 Audit。

`stream` 还会按收到的顺序记录每个 Provider-independent canonical event，包括 answer/reasoning
文本 delta、工具调用开始/参数 delta/结束、usage 和 terminal。写入前会移除 provider
continuation、raw usage 等瞬态字段；达到片段或字节上限后停止追加并记录容量告警，因此它是有界
诊断材料，不承诺在超限后仍可完整重放。

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
`workspace.sqlite`，也不允许从 `features/llm-evidence`
的内部目录导入。需要审计时：

1. Runtime 或 Command 通过注入的 `AuditPort` 发出 `AuditEnvelope`。
2. LLM response/stream evidence 通过 `src/domains/audit` 的上下文函数记录；它只在对应
   等级工作，存储路由由同一个 Audit Runtime 决定并进入 EventStore。
3. CLI 和查询 use case 只读取 EventStore / RunRegistry /
   Telemetry 的公开查询能力。

LLM evidence 使用 AsyncLocalStorage 关联 conversation、run、trace、subrun 和父工具调用。
它会经过 Linnkit 的 durable projection，拒绝图片二进制、provider transient 字段和其他不能长期保存的对象；
单片段超过 512 KiB、单次 run 超过 256 个 stream 片段、64 个 response attempt 摘要、16 个工具
协议错误或 16 个 system reminder 片段时停止继续记录；单次 run 的 response 摘要总大小上限为
1 MiB，stream evidence 总大小上限为 16 MiB。超过上限只记录容量丢弃诊断，不阻断 Agent。
审计写入失败只记录诊断日志，不覆盖正常业务结果。

## 新增审计事件的规范

新增 action 前必须先说明它对应的业务事实、actor、scope、decision 和 evidence。实现必须满足：

- 在 Audit Domain 或明确的 domain
  feature 中定义，不在 CLI、route、store 或 provider adapter 里另起 recorder。
- 使用 `AuditEnvelope.parse` 校验合同；`runId`、`conversationId` 和 `turnId`
  必须来自真实运行上下文。
- evidence 只放为后续调查所需的最小字段；禁止保存凭据、完整环境变量、完整 stdout/stderr、provider
  raw request/response、continuation、raw usage、图片 bytes 和无限增长的 transcript 副本。只有显式
  `stream` 等级可记录模型生成的有界文本/工具参数 delta。
- 明确该 action 属于哪个等级；`behavior` 的事实必须使用已登记的安全前缀，`response` 和
  `stream` 的高体积事实必须有独立字段白名单和容量合同。
- 对容量、失败语义、删除语义和 CLI 查询方式补充测试与文档。
- 不把日志、Telemetry、checkpoint 或内容历史的职责迁移到 Audit。

## 生命周期、删除和膨胀控制

审计事件与普通 RuntimeEvent 共享当前 workspace 的 `workspace.sqlite`
和 run/conversation 归属。删除对话时，EventStore 的 conversation facts
cleanup 会一起删除该对话的审计事件；从历史截断时，属于被截断 run 的事件也按同一事实源规则处理。内存 sink 只用于测试，不需要清理磁盘。

审计不再创建 `<Documents>/LLMRunAudit/` 文件、`.in_progress` checkpoint 文件或 JSONL 正式审计副本。
开发阶段和生产阶段的区别由 Host 运行身份与 `LINNYA_AUDIT_LEVEL` 控制：生产固定 `off`，开发排障
才临时使用 `response` 或 `stream`。stream evidence 的容量上限在写入 EventStore 前执行；统一
conversation startup maintenance 会按固定 7 天窗口清理过期的 `audit_envelope`。

当前不应把 `workspace.sqlite` 中的审计行当作永久无限保留。durable 审计随 conversation/run
事实删除；启动维护还会按固定 7 天窗口删除隐藏 `audit_envelope`，不能为了控体积直接删除用户运行
事实。stream evidence 额外受单 run 16 MiB 和事件数量上限约束。

当前的清理操作按下面的规则执行：

- 开发排障结束后把 `LINNYA_AUDIT_LEVEL` 恢复为 `off`；stream evidence 已写入 `workspace.sqlite`，并由启动维护按 7 天窗口清理。
- 不要手工删除 `workspace.sqlite` 释放审计空间；需要立即释放空间时使用后续提供的 Audit maintenance/query 合同。
- 生产环境固定为 `off`，不会新建任何 Agent Run Audit 事实；普通 Backend/terminal log 仍按 logging owner 的策略运行。
- 当前 CLI 的 `audit` 是只读摘要，没有“清空审计”命令。不要直接删除 `workspace.sqlite`，也不要通过 CLI 另造清理路径。

## 开发和验证

修改本模块后至少验证：

- `resolveAuditLevel` 的默认值、非法值、开发环境等级和 packaged 生产强制 off；
- `behavior / response / stream` 对 action 的过滤；
- LLM stream evidence 只经统一数据库 sink 写入，并在 flush 后可查询；
- 图片 transient、超大证据和协议错误上限按规范丢弃；
- CLI 仍是只读投影；
- 对话删除或历史截断不会留下脱离 conversation/run 的审计事实。

审计模块的坏味道包括：出现新的 `audit*.json` 目录、新的审计环境变量、直接调用
`createFileAudit`、在 store 内拼接信封、把日志叫成审计，或让一个 feature 自己决定 retention。发现这些情况应先修正边界，再继续扩展功能。
