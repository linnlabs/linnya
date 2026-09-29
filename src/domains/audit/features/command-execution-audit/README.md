# Command Execution Audit

这是统一 Audit Domain 下的 command feature，不是第二个审计系统。它只负责把命令事实
投影成 `AuditEnvelope`；写入必须使用 Host 组合后注入的同一个 `AuditPort`。

## 1. 审计的目的

这个 feature 把命令执行中的关键事实写入既有 `AuditEnvelope`。审计用于回答“谁在什么权限上下文中请求了什么、是否审批、是否启动、怎样结束”，不是命令输出仓库，也不是调试日志系统。

## 2. 事件合同

| 事件 | 关键事实 | 明确不记录 |
| --- | --- | --- |
| `proposal_created` | execution identity、cwd 摘要、模式、权限摘要 | 完整环境、PID |
| `authorization_settled` | allow/approval/deny、来源、风险 rule id | 模型隐藏推理 |
| `execution_rejected` | spawn 前拒绝、取消或 owner end 原因 | 未发生的进程事实 |
| `execution_started` | 平台、shell semantics、版本、编码、调用 profile、timeout | 完整 argv |
| `process_action` | poll/wait/cancel/write 等动作和结果、byte 数 | 保护输入正文 |
| `protected_input` | 用户直送来源、execution、时间、byte 数 | 密码和 token 正文 |
| `execution_terminal` | process exit、output drain、tree cleanup、resource release | 完整输出 |

所有字段采用显式投影函数，不能对 launch/environment 对象做展开。新增字段默认不进入审计，必须经过隐私评审。

## 3. 事件顺序和失败

开发审计 sink 的写入失败由统一 Audit Runtime 记录诊断，不阻止命令启动、不撤销已成立的授权，也不改写真实进程终态；`off` 不写审计。Command producer 的 schema / 身份 / 授权校验失败仍保持零 spawn，不得以 best-effort 审计为由绕过。owner 关闭时 drain 已进入 port 的写入。生产恢复依据由执行 owner 的持久记录承载，不能依赖开发审计。

terminal 事件必须在四类事实分别可判断后投影：child exit 不等于完成，output drain 未完成时不能记录完整，tree 仍存活时不能宣称清理成功，resource release 失败要单独保留。

## 4. 存储和保留

统一 Audit Domain 是事实 owner；command audit 作为 KB 级决策事实进入 EventStore 的
`audit_envelope`。LLM response/stream evidence 使用同一 envelope 合同，并由统一等级路由到
当前数据库 sink；不会创建第二个文件型正式审计源。
原始 stdout/stderr 在 command output artifact 中按保留策略维护，
审计只存摘要、计数和状态。任何“为了方便排查”而把完整命令环境或输入写进审计的改动都必须拒绝。

## 5. 设计原因

将审计放在 domain 中而不是 runner 中，可以在未来替换 Electron、Utility 或平台 owner 时保留同一产品事实；将正文和状态分离，可以同时满足调试可追溯和敏感数据最小化。

## 6. 测试门禁

覆盖七类事件、禁止敏感字段、重复投影、非法合同的启动前拒绝、统一入口 sink 失败不改变业务、App end drain、raw artifact 与 audit 的关联以及跨重启读取。测试应验证字段白名单，而不是只断言“写了一条日志”。

## 7. 子运行身份与验收

领域投影只消费 command execution 自身身份；Host adapter 通过注入的 supervisor `peek`
读取该 run 的持久注册事实，验证 conversation 并填入直接 `parentRunId`。root 不带父身份。
取消后迟到的 terminal、恢复后新建的 adapter 和并发 child 都按 execution owner 查询，
不从 AsyncLocalStorage、root permission ID 或工具名推测。

EventStore 保留严格父子身份校验；未知或跨 conversation 的 run 不得投影成可持久化事实。
真实 SQLite 集成覆盖 root、并发 child、取消后 terminal、重建 adapter 和 LLM response，
只有 mock sink 的测试不能代替父子身份验收。Telemetry usage 可用不证明 response 已落盘。
