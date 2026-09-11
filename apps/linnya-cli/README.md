# Linnya Conversation CLI

`linnya` 是正在运行的 Linnya 桌面 App 的轻量命令行控制面。它复用 App Host 的正式 Conversation admission、Flow、持久化和 read model，不直接读写 SQLite，也不在 CLI 进程里启动第二套 Agent runtime。

适用场景：脚本化发消息、查询会话与消息、观察运行状态、处理 `awaiting_user`、终止运行、读取最终回答、调用五个基础 Workspace 工具，以及作为 Benchmark 或外部 Agent 的稳定进程入口。

## 1. 运行前提

- Node.js 20 或更高版本。
- Linnya 桌面 App 正在运行，且后端路由已经完成初始化。
- 在仓库内开发时已执行 `pnpm install`。

源码模式：

```bash
pnpm linnya:cli --version
pnpm linnya:cli models --pretty
pnpm linnya:cli list --limit 5
```

脚本消费 JSON 时使用 `pnpm --silent linnya:cli` 去掉 pnpm 横幅，或直接调用已构建的 `node apps/linnya-cli/bin/linnya.cjs`。

这里不需要在脚本名后再加 `--`；多余分隔符会被 CLI 当作位置参数。

构建并运行独立 bundle：

```bash
pnpm build:linnya-cli
node apps/linnya-cli/bin/linnya.cjs help
```

当前仓库已经产出可独立执行的 CommonJS bundle 和 `bin/linnya.cjs`，但桌面安装器尚未把它安装到系统 `PATH`，也没有随 CLI 打包 Node runtime。因此当前正式使用仍要求 Node.js 20；安装器集成属于发行工作，不属于 Conversation 控制面。Electron 的 `runAsNode` fuse 已关闭，不能把 Electron 可执行文件当作 CLI 的 Node 替代品。

## 2. 一个最小的 PPT 真实请求

Slides Agent 通过 Workspace 工具读写 `.slides` 文件，因此新会话必须显式绑定目标 Workspace 项目。请先取得真实项目 ID，并用它替换下方的 `<project-id>`；CLI 不会根据当前前端页面猜测项目，避免把文件写入错误项目。

先查询当前 App 已经物化的模型。Chat 列表中的 `model_config_id` 可传给 `--model`，图片生成列表中的同名字段可传给 `--image-model`；`model_name` 只是供应商侧识别信息，不能替代本地选择身份：

```bash
pnpm linnya:cli models --pretty
```

`available=false` 会同时返回 `capability_missing / route_missing / credential_missing` 之一。查询和 `send` 共用同一可用性规则，因此不可用模型会在创建会话或运行前被拒绝。

先发送请求；成功回执只表示用户输入已经 durable commit 且运行已被 Host 接纳，不表示 PPT 已完成：

```bash
pnpm linnya:cli send \
  "生成一份 3 页的极简产品介绍 PPT，包含封面、核心价值和下一步" \
  --project <project-id> \
  --agent slides_agent \
  --image-model chatgpt-subscription-gpt-image-2 \
  --reasoning medium
```

`--image-model` 只冻结这次请求使用的图片生成模型，不修改前端设置或会话偏好。为了让 Benchmark 可复现，向已有会话继续发送消息时也应显式重复该选项；省略时沿用 Agent 正常的图片模型解析规则。

从 JSON 回执保存 `receipt.conversation_id` 和 `receipt.run_id`，然后观察状态：

```bash
pnpm linnya:cli status <conversation-id> --run <run-id> --watch
```

`--watch` 输出 JSONL，只在状态快照变化时写一行。到达 `awaiting_user` 或任一终态后退出。若需要用户输入，使用该帧中的 `pending_interaction.interaction_id`：

```bash
pnpm linnya:cli respond <conversation-id> \
  --interaction <interaction-id> \
  --approve
```

也可以选择 `--skip`、`--submit-json '<json>'` 或 `--modify-json '<json>'`，四者必须且只能选一个。响应成功后可以再次执行 `status --watch`。运行完成后精确读取该次运行的最终回答：

```bash
pnpm linnya:cli result <conversation-id> --run <run-id>
```

## 3. 命令

| 命令 | 作用 | 主要选项 |
| --- | --- | --- |
| `send <message>` | 新建会话并发送消息；或向空闲的已有会话发送下一条消息 | `--conversation`、`--project`、`--agent`、`--model`、`--image-model`、`--reasoning` |
| `models` | 查询可用于 `--model` 与 `--image-model` 的本地模型配置 | 无 |
| `list` | 查询已有会话 | `--limit`、`--cursor`、`--search`、`--project` |
| `messages <conversation-id>` | 按会话查询 durable 消息窗口 | `--limit`、`--before`、`--after` |
| `status <conversation-id>` | 查询当前或指定 root run 的状态 | `--run`、`--watch`、`--interval`、`--timeout` |
| `respond <conversation-id>` | 回应当前 `awaiting_user` 交互并继续同一 run | `--interaction`，以及一个 response 选项 |
| `stop <conversation-id>` | 终止当前 foreground root run，并等待真实终态结算 | `--run`、`--reason` |
| `result <conversation-id>` | 读取指定或最近 terminal root run 的最终回答 | `--run` |
| `audit <conversation-id>` | 只读导出统一 Audit Domain 的安全执行摘要 | `--run` |
| `tools list` | 列出 CLI 允许调用的 Workspace 工具名称与简介 | 无 |
| `tools describe <tool-name>` | 查询一个 Workspace 工具的真实参数合同 | 无 |
| `tools call <tool-name>` | 在绑定项目的 Conversation 中执行一次 Workspace 工具调用并等待结果 | `--conversation`、`--project`、`--args-json` / `--args-file`、`--omit-args`、`--interval`、`--timeout` |

`messages` 的游标属于整个会话，所以不提供 `--run` 过滤。按 run 精确读取结果应使用 `result --run`；客户端先分页再过滤会让 `has_more` 与实际结果不一致。

`send` 的单条消息上限是 200,000 个字符（按协议字符串长度计），由 App 握手的 `limits.max_message_chars` 正式声明。它只是 Conversation CLI 的 Host 入口限制，不是 Linnkit 的 token 上限；最终模型输入仍由 Agent 的上下文预算统一计量和接纳。

### 3.1 调用 Workspace 工具

CLI 固定只开放 `list_files / read_file / grep / write_file / edit_file`。它不会接受 Shell、插件工具或任意注册工具。`tools list` 只返回名称与简介；需要调用时再用 `tools describe` 读取 App 当前注册的完整正式 schema，避免为发现工具反复传输全部参数合同：

```bash
pnpm linnya:cli tools list --pretty
pnpm linnya:cli tools describe write_file --pretty

pnpm linnya:cli tools call list_files \
  --project <project-id> \
  --args-json '{}'

pnpm linnya:cli tools call read_file \
  --conversation <conversation-id> \
  --args-json '{"locator":"workspace:/notes.md"}'

pnpm linnya:cli tools call write_file \
  --project <project-id> \
  --args-json '{"locator":"workspace:/notes.md","content":"# Notes"}'
```

`read_file` 的普通文本参数遵循 1-based 行窗口：`offset` 是起始行，`limit` 是最大行数；输出中的
`行号 |` 仅用于定位，编辑时不属于 `old_string`。结构化 `view="document"` 改用
`offset_chars/max_chars`。CLI 不重新解释这些字段，完整合同以 `tools describe read_file` 返回的 App
当前 schema 为准。

作用域规则只有三条：

- 只传 `--project`：创建一个绑定该项目、前端可见的新 Conversation，并返回 `conversation_id`。
- 只传 `--conversation`：从已有 Conversation 取得项目；不存在或未绑定项目时拒绝执行。
- 两者都传：验证 Conversation 确实属于该项目；不一致时拒绝执行。两者都不传同样拒绝。

`--args-file <path>` 从 UTF-8 JSON 文件读取整个工具参数对象，与 `--args-json` 互斥，适合大型 deck.js。`--omit-args` 只省略 CLI 回显中的工具入参，保留结果和诊断；不修改 App 历史。结果含 error 级文档诊断时也返回退出码 `8`，即使源码保存成功。

`tools call` 不调用 LLM。它仍通过正式 Flow、ToolNode、ToolContext、权限、审计、pending revision 和 Conversation UI 投影执行，因此前端能看到这次工具调用的历史，写入行为也与 Linnya Agent 使用同一工具时完全一致。CLI 会等待 run 和工具卡都完成：工具成功时把完整工具消息写到 stdout；工具自身返回 error 时把同一消息写到 stderr，并以退出码 `8` 结束。

### 3.2 与 Slides CLI 的区别

| 入口 | 适用调用方 | 当前职责 | 是否依赖正在运行的 Linnya |
| --- | --- | --- | --- |
| `linnya ...` | 外部 Agent、脚本、人 | Conversation 控制，以及五个 Workspace 工具；可读写 `.slides` 源码 | 是 |
| `linnya-slides ...` | Linnya Agent 的 `shell` | 通过当前 Shell 的临时 bridge 执行 Slides `inspect / render / fonts` | 是，而且只能在受管 Shell execution 内使用 |
| `pnpm slides:cli -- ...` / 插件 `entry.command` | 外部 Agent、人、CI | Standalone Slides 只读诊断、检查图与字体查询 | 否；自行提供数据库和输出目录 |

`linnya-slides` 不是给外部进程直连 App 的通用命令：它依赖父 Shell 临时注入的 execution token。外部 Agent 若只需要编辑当前 Linnya 项目，应使用 `linnya tools call`；若需要脱离 App 做 Slides 检查或渲染，应使用 Standalone Slides CLI。两者当前没有相互转发。Slides CLI 的完整参数与运行环境见 [`presentationCli/README.md`](../../packages/plugins/slides/src/backend/features/presentationCli/README.md)。

`audit` 是查询和导出入口，不是审计 recorder；它不会写数据库、写文件或根据 CLI 参数开启另一种审计。从 RunRegistry 读取权威 run/Agent/终态，从统一 Audit Domain 所写的 EventStore 配对 durable tool decision/output，
并复用 Command Audit 区分 Tool error 与 Shell 子进程非零退出。`tool_pairing.complete` 及
`paired / decision_missing / terminal_missing / duplicate_terminal` 可直接判断是否存在永久
loading 对应的事实缺口；realtime-only `tool_process` 不会被冒充为历史开始时间。模型、
canonical token usage、工具耗时、context compaction 与 run terminal 观测来自 Telemetry。
压缩部分按 root / child run 返回全部观测数、真实 Provider attempt 数、完成数和 Provider
actual usage 覆盖，并展示护栏、触发水位、前后 token、请求耗时与 cache read。每条明细的
`generation_attempted` 直接说明是否已经发出 Provider 请求；发送前的容量或护栏阻断仍计入
观测与 outcome，但不计入 `attempts` 或 `missing_usage_calls`。run terminal 部分返回
`steps_used / max_steps / terminal_reason`。输出不包含 prompt、回答或摘要正文、工具参数、
工具输出或原始错误正文。Telemetry 默认保留 7 天且写入失败不阻断任务，因此 Telemetry
部分明确标记为 `best_effort`；真实调用缺少 usage 时，`missing_usage_calls` 也不会被补成 0。

CLI 不负责开启或切换 Agent Run Audit 等级。开发环境的等级由 App 启动时的
`LINNYA_AUDIT_LEVEL=off|behavior|response|stream` 决定，修改后需要重启 App；CLI 只读取当前有效
审计并导出安全摘要。生产 Desktop 不打包此 CLI，且生产 Host 固定关闭开发 Agent Run Audit；即使外部
自行运行 Node 版 CLI，也不能通过控制面开启审计，`audit` 能力不会在生产握手中声明。

## 4. 状态与控制语义

CLI 公开的运行状态是：

```text
pending -> running -> awaiting_user -> running -> completed | failed | cancelled
```

- 没有主动 `pause` 命令。
- `awaiting_user` 是 Runtime 被动等待，不是人为暂停；通过 `respond` 继续。
- `stop` 是唯一主动中断动作。它会等待 Host 的取消完成屏障，并返回真实的 `cancelled`、`completed` 或 `failed` 结算，避免把“已发取消请求”误报成“已经取消”。
- `status` 不虚构百分比。生命周期来自 RunRegistry；运行中的节点与累计步数来自同一 activation 已持久化的 Graph 执行快照，交互、错误和结果可用性继续由各自 owner 投影。
- `send` 返回后 CLI 可以退出，后台运行归 Linnya App 所有，不依赖 CLI 进程存活。

对已有会话执行 `send --conversation <id>` 时，如果该会话已有 active foreground run，会得到 `conversation_busy`，不会并发写入第二条 foreground 主链。

续跑 `send --conversation <id>` 和审批 `respond <id>` 均自动继承该会话保存的项目，不必重复 `--project`。显式传入时必须与原项目一致，否则在启动/恢复前拒绝；不能借此迁移会话。无项目聊天仍可续跑，但 Workspace 工具要求项目。模型选择仍按原有解析规则；对比测试应继续显式传 `--model`，不要把项目继承理解成冻结模型配置。

## 5. 输出与退出码

普通成功命令向 stdout 写一个 JSON 值；`--pretty` 只改变普通命令的缩进。`status --watch` 向 stdout 写 JSONL，不能与 `--pretty` 组合。所有失败都向 stderr 写一个稳定 JSON 值：

```json
{"schema_version":1,"ok":false,"command":"send","error":{"code":"conversation_busy","message":"...","retryable":true}}
```

退出码：

| 码 | 含义 |
| ---: | --- |
| `0` | 成功 |
| `2` | 参数或请求合同错误 |
| `3` | App 未运行、连接描述过期或本地传输失败 |
| `4` | CLI 与 App 协议不兼容 |
| `5` | 未授权 |
| `6` | 运行状态冲突，例如 busy、run/interaction 不匹配 |
| `7` | 当前 App 版本未提供请求的能力 |
| `8` | Host 或 CLI 内部错误 |

Benchmark 应把 CLI 当作子进程，解析 stdout 的 JSON/JSONL，并用退出码分类失败；不要复制 CLI 的连接协议，也不要直接访问数据库。

## 6. 本地连接与安全

App 启动后原子发布当前实例的私有连接描述：

```text
~/.linnya/runtime/conversation-control-v1.json
```

测试或多实例隔离可以设置 `LINNYA_CLI_CONNECTION_FILE` 覆盖路径。目录权限为 `0700`，文件权限为 `0600`；文件包含 loopback 地址、实际端口、App 实例 ID 和随机 session token。App 正常退出会撤销自己发布的描述文件。

CLI token 只允许访问 `/api/v1/conversation-control/*`，Renderer token 也不能访问该命名空间。token 在 body parser 前校验，不写入普通日志。CLI 连接时还会校验协议版本、握手返回的 App 实例 ID 和能力上限，避免使用陈旧文件连到另一个进程。

## 7. CLI 自身怎么测试

日常修改至少运行：

```bash
pnpm typecheck:linnya-cli
pnpm test:linnya-cli
pnpm build:linnya-cli
```

测试按真实风险分层：

| 层 | 证明什么 |
| --- | --- |
| schema 合同 | 非法字段与组合被拒，状态、回执和错误 wire 保持 strict |
| parser / orchestration | 命令映射、JSON 响应、退出码、watch 去重与停止条件正确 |
| CLI 进程集成 | 真实 Node 子进程连接脚本化 HTTP bridge，验证 stdout/stderr、JSONL 和稳定退出码 |
| Host use case 集成 | send durable acceptance、busy、HITL resume、stop settlement、run 精确结果读取 |
| ApiServer / bridge 集成 | token 双向隔离、loopback、描述文件权限和生命周期、稳定 HTTP 错误 |
| 真实 App smoke | 穿过实际 Linnya App、模型、Slides Agent 与 PPT 工具链，验证产品可用性 |

前三层不能替代 Host/bridge，Host/bridge 也不能替代真实模型 smoke。真实 App 验收建议按本 README §2 跑一个 3 页 PPT，并传入专门用于验收的 Workspace `--project`：保存回执，关闭首个 CLI 进程后继续 watch；若出现 `awaiting_user` 就 respond；完成后用同一 `run_id` 取 result。审批回归请求应明确包含“提交计划并等待确认”，用来验证 `--approve` 后 Agent 识别等待条件已经满足、不会重复索要同一确认。另补一个运行中 `stop --run` 场景，确认返回 terminal settlement。

## 8. 维护边界

- Wire DTO 与版本：`packages/schemas/src/conversation-control/`。
- 产品业务编排：`src/app-hosts/linnya/application/conversation-control/`。
- 模型运行可用性：`src/app-hosts/linnya/application/model-runtime-availability/`。
- 本地 HTTP、鉴权与连接描述：`src/app-hosts/linnya/adapters/conversation-control-bridge/`。
- CLI 只负责参数、连接、输出和 watch；不能导入 Flow、数据库或 Electron 内部实现。

CLI 新能力应先成为 Host application use case 的窄 public contract，再通过 bridge 暴露，最后接入命令；不能从 CLI 直接绕过现有控制面。

Workspace 五件套的参数、locator 与 pending revision 语义见 [`src/tools/workspace/README.md`](../../src/tools/workspace/README.md)。

### 项目发现

先运行 `pnpm --silent linnya:cli projects`，从响应的 `projects[].project_id` 选择 `tools call --project` 或 `send --project` 的目标。命令复用当前 App 的 Workspace owner，仅返回未删除项目的 ID 和名称；旧 App 未声明 `projects` capability 时会明确拒绝。

写入后若构建失败，文档可能保存为 draft；`read_file` 的 `sourceOrigin: draft` 表示当前草稿源码，而版本 ID/编号仍对应最后成功 revision。这不代表成功构建；请结合 error diagnostics 与 build failure 判断，并在修复后重新写入。
