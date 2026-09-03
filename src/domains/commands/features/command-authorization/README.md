# Command Authorization

## 1. 功能边界

这个 feature 在命令真正创建进程之前，回答一个问题：**这次 proposal 是否可以启动，还是必须先让用户审批**。它只处理授权事实和匹配规则，不负责展示弹窗、不负责写权限设置文件，也不负责启动进程。

Shell 是文本协议，不能靠一个“看起来像只读”的字符串判断安全。因此这里采用两层判断：权限档位先决定大方向，固定风险规则再决定标准档是否需要审批。它是风险提示和权限门，不是完整的 Shell 解释器，也不是操作系统级文件沙箱。

## 2. 代码树

```text
command-authorization/
├── definitions/
│   ├── commandAuthorizationDecision.ts   # allow / approval_required / reject
│   ├── commandProposalAuthorization.ts   # proposal 与审批事实的公开合同
│   ├── commandRiskRule.ts                # 风险规则接口、匹配结果
│   └── simpleCommand.ts                  # 可安全记忆的简单命令结构
├── functions/
│   ├── evaluateCommandAuthorization.ts   # 权限档位总判断
│   ├── detectObviousShellWrite.ts        # read_only 写入门
│   ├── matchFixedRiskRule.ts             # 固定风险库匹配
│   ├── scanZshSimpleCommand.ts           # macOS 简单命令扫描
│   ├── scanPowerShellSimpleCommand.ts    # Windows 简单命令扫描
│   ├── deriveSimpleCommandCandidate.ts   # 生成可记忆前缀
│   ├── matchConversationCommandApproval.ts
│   └── rules/{macos,windows}.ts
└── orchestration/authorizeCommandProposal.ts
```

`functions/` 必须保持纯计算：输入是已冻结的 proposal、permission snapshot 和平台语义，输出是决定或匹配事实。文件读取、IPC、审批持久化和 owner 操作只能由上层 orchestration 调用。

## 3. 权限档位和决策顺序

| 档位 | 直接允许 | 需要用户动作 |
| --- | --- | --- |
| `read_only` | 明确判断为只读的命令 | 写入、创建、删除、移动、覆盖、上传等超出只读范围的命令 |
| `standard` | 未命中固定风险规则的命令 | 固定规则识别出的删除、覆盖移动、外部上传、下载后执行、系统或磁盘影响 |
| `full_access` | 不触发审批的命令 | 不弹审批；仍受固定 `gui_control = denied`、`local_ipc_control = denied` 和随 run 结束的生命周期边界约束 |

实际顺序固定为：

1. 校验 `ShellCommandProposalV1`，包括命令长度、NUL、cwd 和交互模式。
2. 根据当前 run 的 `CommandPermissionSnapshotV1` 确定基础档位；不能重新读取设置文件。
3. `read_only` 先调用 `detectObviousShellWrite`。无法证明只读就走审批，不得因为“没匹配到写入词”而放行。
4. `standard` 调用平台对应的固定风险规则。命中一条或多条都只生成一个审批请求，原因列表保留全部 rule id。
5. `full_access` 不再请求命令审批，但不能提升固定 capability；GUI、local IPC 和脱离 run 生命周期的执行仍必须在进入平台启动前拒绝。
6. 只有简单命令能生成对话级记忆候选；复杂脚本、管道拼接、嵌入脚本和无法完整扫描的文本只能 `allow_once`。

## 4. 关键数据

### 4.1 `CommandPermissionSnapshotV1`

```text
protocol_version
kind = command_permission_snapshot
identity = { conversation_id, agent_run_id, tool_call_id, execution_id }
base_level = read_only | standard | full_access
effective_level = read_only | standard | full_access
grant_source = global_setting | allow_once | conversation_approval
internal_data_access = allowed | denied
```

Schema 对提升有结构性限制：`global_setting` 不能改变用户选中的档位；审批只能把 `read_only` 或 `standard` 临时提升到 `standard`，不能通过一次审批变成 `full_access`。因此调用方不能靠拼一个对象绕过规则。

### 4.2 审批原因

`CommandApprovalReason` 只有两类：

- `permission_elevation`：从 `read_only` 临时提升到 `standard`。
- `fixed_risk_rule`：携带 `rule_id` 和风险类别。

风险类别目前是 `delete`、`move_overwrite_rename`、`external_upload`、`download_and_execute`、`system_or_disk_impact`。规则 id 是审计和测试的稳定标识，修改规则语义时必须增加 matcher revision 或明确迁移策略。

### 4.3 对话级记忆

只有 `deriveSimpleCommandCandidate` 能生成候选。候选包含 token 前缀和：

```text
platform
shell_semantics_id
matcher_revision
```

匹配时必须先比较 conversation scope，再比较上述上下文，最后比较 token 前缀。不能只用原始字符串，也不能把一条复杂脚本记忆成“以后都允许”。批准持久化成功后才可写入 `conversation_approval` 事实；失败时退化为本次允许或保持拒绝，不能静默放开。

## 5. 平台规则

macOS 使用 zsh 语义扫描，Windows 使用 PowerShell 简单命令扫描。两边共享风险类别和审批合同，但不共享词法细节。PowerShell 5.1 与 7 的语义 id 必须不同，避免同一前缀在不同解释器下复用错误授权。

规则是“小而明确”的固定库，不追求穷举所有恶意脚本。规则新增必须同时提供：真实命令样本、预期命中/不命中、误判说明、平台范围和回归测试。规则不得读文件、访问网络或调用外部解析器。

## 6. 失败和安全要求

- proposal 不合法：`invalid_input`，零 spawn。
- cwd 或权限快照不可用：`permission_unavailable`，零 spawn。
- 需要审批但页面不可用：保持 pending 或由上层取消，不能自动允许。
- 规则扫描无法可靠完成：按需要审批处理，不得按低风险放行。
- 记忆上下文不匹配：只允许本次，不能复用旧批准。
- `internal_data_access = denied` 时，访问 Linnya 内部数据的命令由 host 拒绝，并给出设置入口提示；这个开关独立于三档权限。
- `gui_control = denied` 不是一条可审批风险规则。直接或经解释器、自定义二进制启动 GUI 都必须由平台执行边界拒绝；当前跨解释器 enforcement 与正式 fixture 是 Command 上线门禁。

审计中只记录稳定摘要、规则 id、决定和来源，不记录完整环境、PID、保护输入正文或完整输出。

## 7. 开发规范

1. 先更新 schema 和 `definitions`，再写规则函数；不要在 UI 或 shell runtime 里复制判断。
2. 新规则必须有独立 id，不能复用模糊的“危险命令”总规则。
3. 任何会改变“是否可记忆”的修改，都要检查跨平台语义和旧批准事实的兼容性。
4. 禁止添加“匹配失败就放行”的 fallback。无法确认只读时，选择审批或拒绝。
5. 注释解释为什么不能扩大记忆范围、为什么要绑定 matcher revision，不重复描述代码语句。

## 8. 端到端测试门禁

- `fixedRiskAuthorization.integration.test.ts`：五类风险和跨平台语料。
- `simpleCommandApprovalMatcher.integration.test.ts`：简单命令候选、前缀边界、上下文不匹配。
- `commandApprovalContract.integration.test.ts`：Zod 结构性限制和审批选择。
- Shell runtime integration：确认授权失败时没有 child、owner 或输出文件。
- 每次新增规则要同时覆盖：命中、相似但安全、不完整脚本、NUL/超长输入、Windows 普通用户运行。
- GUI denial 需要穿过真实 production runner 的 macOS/Windows E2E；纯规则测试或 schema 中存在 `denied` 字段不能证明执行边界成立。

## 9. 相关文档

- 全局合同：[命令执行总览](../../README.md)
- 权限设置：[permission-settings](../permission-settings/README.md)
- 审批 owner：[App Host approval host](../../../../app-hosts/linnya/adapters/commands/approval-host/README.md)
- 输出和审计：[command output](../../../../app-hosts/linnya/adapters/commands/output/README.md)、[audit](../../../audit/features/command-execution-audit/README.md)
