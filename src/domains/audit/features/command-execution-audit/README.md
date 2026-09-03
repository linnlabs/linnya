# Command Execution Audit

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

启动前审计写入失败时保持零 spawn，并返回明确的审计不可用错误。启动后某一条审计写入失败不能改写真实进程终态；应标记审计不完整，并在 owner 关闭时 drain 已进入 port 的写入。

terminal 事件必须在四类事实分别可判断后投影：child exit 不等于完成，output drain 未完成时不能记录完整，tree 仍存活时不能宣称清理成功，resource release 失败要单独保留。

## 4. 存储和保留

EventStore 是事实载体；LLM audit、应用日志和 command audit 不是同一格式。原始 stdout/stderr 在 command output artifact 中按保留策略维护，审计只存摘要、计数和状态。任何“为了方便排查”而把完整命令环境或输入写进审计的改动都必须拒绝。

## 5. 设计原因

将审计放在 domain 中而不是 runner 中，可以在未来替换 Electron、Utility 或平台 owner 时保留同一产品事实；将正文和状态分离，可以同时满足调试可追溯和敏感数据最小化。

## 6. 测试门禁

覆盖七类事件、禁止敏感字段、重复投影、启动前失败、启动后 sink 失败、App end drain、raw artifact 与 audit 的关联以及跨重启读取。测试应验证字段白名单，而不是只断言“写了一条日志”。
