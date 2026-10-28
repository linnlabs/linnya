# Linnya Conversation CLI

`linnya` 同时提供轻量命令行控制面和源码开发用的前台 Runtime
Host。普通命令连接当前 Workspace 的唯一 Backend，复用正式 Conversation
admission、Flow、持久化和 read model；`runtime start`
则在不启动 Electron 的情况下监督同一 App
Server 实现。两种入口都不让 CLI 直读 SQLite，也不创建每 Agent 一套 Backend。当前仅供仓库内开发、评测与 Benchmark 使用，尚未作为生产功能开放或随桌面产品分发。

当前适用场景：开发环境中脚本化发消息、查询会话与消息、观察运行状态、处理
`awaiting_user`
与 Shell 命令审批、终止运行、读取最终回答、调用基础 Workspace 工具及临时开放的 Web 工具，以及在没有 Electron 时启动可运行多个会话/Agent 的前台 Backend。

新版研究使用
`send --agent research_v1`，需显式项目和可用模型，与前端“研究”使用同一主 Agent 和通用子任务入口，普通请求允许开放查找资料。严格材料任务使用
`--research-scope-json JSON`：按 Research schema 声明
`question`、`reader`、`task_type`（open/fixed/update）、`materials` 和可选
`time_range`；fixed/update 必须有正式 Workspace 材料。原消息与 scope 分别保留：CLI 沿正式 options 传递
`research_scope`，Host 首次接纳后冻结为运行请求的
`researchScope`，不再强制调用旧
`research_run`。该参数仅映射研究入口，不开放任意工具；显式范围使用新会话，拒绝未绑定的历史/附件/编辑器上下文。普通入口交接可见历史和片段，但不把它们视为版本绑定的全文。材料范围通过研究系统提示和具体子任务请求传递，不是文件或网络权限沙箱；新研究不再使用专用提交/完成工具。流程与限制见
[Research 用例](../../src/app-hosts/linnya/application/research/README.md)。

Workspace 是整套数据的运行边界，可包含多个 Project。`runtime start --workspace` 接受物理数据根；普通命令先通过连接描述选中 Backend，再用 `--project` 选择项目。`workspace:/` 是指定项目内的文档路径，不是宿主目录。正式定义见[产品模型](../../docs/product-model-overview.md#20-workspaceproject-与导航上下文)。

## 1. 运行前提

- 仓库开发使用项目声明的 Node.js 24；App
  Server 始终使用仓库准备并校验过的固定 headless Node。
- 普通命令需要 Linnya Desktop 或 `linnya runtime start`
  已为目标 Workspace 启动 Backend。
- 在仓库内开发时已执行 `pnpm install`。

源码模式：

```bash
pnpm linnya:cli --version
pnpm linnya:cli models --pretty
pnpm linnya:cli list --limit 5
```

脚本消费 JSON 时使用 `pnpm --silent linnya:cli`
去掉 pnpm 横幅，或直接调用已构建的 `node apps/linnya-cli/bin/linnya.cjs`。

支持 `help / --help / -h`；pnpm 脚本后的可选 `--` 分隔符也可正常使用。

构建并运行独立 bundle：

```bash
pnpm build:linnya-cli
node apps/linnya-cli/bin/linnya.cjs help
node apps/linnya-cli/bin/linnya.cjs doctor --pretty
```

无 Electron 的源码 Runtime：

```bash
pnpm linnya:runtime --workspace <workspace-absolute-path>

# 也可以先构建，再直接运行 bundle
pnpm build:linnya-runtime
node apps/linnya-cli/bin/linnya.cjs runtime start \
  --workspace <workspace-absolute-path>
```

Runtime 在 stdout 输出一次 ready JSON 后保持前台运行；另一个终端中的普通
`linnya` 命令通过同一私有连接描述访问它。`--api-port 0`
是默认值，由 OS 选择空闲 loopback 端口；`--qdrant-port`
默认 6333。一个 Workspace 同时只允许一个 Desktop 或 CLI Runtime
owner，竞争启动以 `conversation_busy` 拒绝，不做隐式 attach、接管或另开数据库。

关闭某个 `send/status`
客户端不会停止已接纳的 run。关闭 Runtime 终端、Ctrl+C 或 SIGTERM 会停止该 Runtime 拥有的 Backend、所有任务和子进程；CLI
launcher 被强制终止时，App Server 也会按 parent identity 收口并释放 Workspace
owner。这里没有 daemon、系统服务、开机启动或关闭 Linnya 后继续运行。

交互式 TTY 会在 stderr 呈现 shell command
approval，并只接受 Host 声明的选择；stdout 仍只保留机器可读 JSON。stdin/stderr 不是 TTY 时不创建终端 presenter，也不会自动批准。普通控制 CLI 可通过下述
`approvals / approval-reply` 访问同一个 Host 审批 owner；普通 HITL 继续使用
`respond`，它与 Shell 审批是两条不同合同。

当前仓库可以产出供开发测试的 CommonJS CLI/Runtime bundle 和
`bin/linnya.cjs`，但桌面安装器不把它安装到系统
`PATH`，也没有形成独立 CLI 安装包；这不构成生产 CLI 发行。Electron 的
`runAsNode` fuse 已关闭，不能把 Electron 可执行文件当作 CLI 的 Node 替代品。

独立分发必须同时携带 `bin/linnya.cjs`、`dist/cli.cjs` 和
`dist/build.json`。launcher 核对产物 SHA-256；在包含源码的仓库内还核对 CLI、公共 Schema、构建输入与锁文件的内容指纹。产物缺失、损坏或源码变更后未重建会以退出码 4 明确拒绝，不自动切换运行入口。版本号不变也能发现旧 bundle。`--version`
显示 `source` 或 bundle 指纹；`doctor`
只读显示 CLI 身份、App 实例、协议与能力，不打印连接 token 或描述文件。

## 2. 一个最小的 PPT 真实请求

所有 CLI `send`（包括已有会话的续写）必须显式提供非空
`--project`，缺失时在连接 Host 前以 `invalid_request`
拒绝。前端目前没有无项目会话入口，CLI 不应创建用户无法定位的会话。Slides
Agent 同样遵守此规则。请先取得真实项目 ID，并用它替换下方的
`<project-id>`；CLI 不会根据当前前端页面猜测项目。用 `projects list` 查询已有项目；空库可直接用
`projects create "演示文稿"` 创建，再将响应中的 `project.project_id` 传给 `send --project`。
创建项目只写入连接到的 Host 当前 Workspace，不创建另一套数据库或切换 Desktop 导航。

先查询当前 App 已经物化的模型。Chat 列表中的 `model_config_id` 可传给
`--model`，图片生成列表中的同名字段可传给 `--image-model`；`model_name`
只是供应商侧识别信息，不能替代本地选择身份：

```bash
pnpm linnya:cli models --pretty
```

`available=false` 会同时返回
`capability_missing / route_missing / credential_missing` 之一。查询和 `send`
共用同一可用性规则，因此不可用模型会在创建会话或运行前被拒绝。

先发送请求；成功回执只表示用户输入已经 durable
commit 且运行已被 Host 接纳，不表示 PPT 已完成：

```bash
pnpm linnya:cli send \
  "生成一份 3 页的极简产品介绍 PPT，包含封面、核心价值和下一步" \
  --project <project-id> \
  --agent slides_agent \
  --image-model chatgpt-subscription-gpt-image-2 \
  --reasoning medium
```

`--image-model`
只冻结这次请求使用的图片生成模型，不修改前端设置或会话偏好。为了让 Benchmark 可复现，向已有会话继续发送消息时也应显式重复该选项；省略时沿用 Agent 正常的图片模型解析规则。

从 JSON 回执保存 `receipt.conversation_id` 和 `receipt.run_id`，然后观察状态：

```bash
pnpm linnya:cli status <conversation-id> --run <run-id> --watch
```

`--watch` 输出 JSONL，只在状态快照变化时写一行。发现 `command_approvals`
中待回复请求、到达已收口 `paused`、`awaiting_user`
或任一终态后退出；仍在收口的暂停继续观察。恢复已收口暂停必须指定 exact run：

```bash
pnpm linnya:cli resume <conversation-id> --run <run-id>
```

CLI 会先读取该 run 的当前
`execution_id / updated_at`，再通过 Host 正式 continuation 提交同一暂停快照的 fence；它不调用
`send`、不创建
`user_input`，也不会把 HITL 当作普通暂停。若需要用户输入，使用状态帧中的
`pending_interaction.interaction_id`：

```bash
pnpm linnya:cli respond <conversation-id> \
  --interaction <interaction-id> \
  --approve
```

也可以选择 `--skip`、`--submit-json '<json>'` 或
`--modify-json '<json>'`，四者必须且只能选一个。响应成功后可以再次执行
`status --watch`。运行完成后精确读取该次运行的最终回答：

```bash
pnpm linnya:cli result <conversation-id> --run <run-id>
```

### Shell 命令审批

`status` 保留真实 run 生命周期；命令仍在等待启动时，可能是 `running`，但同时返回
`command_approvals`。每个请求给出 command、cwd、触发原因、允许选项，以及实际
`agent_run_id / origin_tool_call_id / command_execution_id`。根 run 的状态包含其 child
run 子树中的待处理请求，不能把根 run 身份当成子请求实际归属。

```bash
pnpm linnya:cli approvals <conversation-id> --run <root-or-child-run-id>
pnpm linnya:cli approval-reply <conversation-id> \
  --run <pending-agent-run-id> \
  --request <approval-request-id> \
  --choice allow_once
```

`approvals` 只读查询指定 run 及其子树；`approval-reply`
必须绑定请求的实际 run，选择 `allow_once`、`deny`，或请求明确提供的
`allow_for_conversation`。不提供默认选择，也没有“全部批准”。记忆放行的 token 前缀由 owner 展示和校验，CLI 不能提交新的命令、路径或权限。

`awaiting_reply` 会让 `status --watch` 返回控制权；`processing`
表示已有客户端作答，继续观察。回复回执 `accepted`
只表示接纳，授权持久化和命令最终结果仍需观察原 run；不需要 `resume` 或再
`send`。后续 `status --watch` 使用最初发送回执里的 foreground root `run_id`；
`approval-reply --run` 使用的 child 身份不等于 `status`
支持的查询目标。Renderer 与 CLI 竞争回复时只有一次接纳，旧请求返回 `stale`
回执及退出码 6。回复传输失败不自动重试：先查询 exact 请求和原 run，避免把未确认回执当成未执行。

Shell 审批与 `respond --approve` 无关。控制协议自 3 起要求明确返回
`command_approvals` （无请求为
`[]`）；旧 Host 必须更新，不能把缺失字段猜成“没有等待”。

## 3. 命令

| 命令                               | 作用                                                              | 主要选项                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `runtime start`                    | 不启动 Electron，前台监督当前 Workspace 的唯一 App Server Backend | `--workspace`、`--api-port`、`--qdrant-port`                                                           |
| `send <message>`                   | 新建会话并发送消息；或向空闲的已有会话发送下一条消息              | `--project`（必填）、`--conversation`、`--agent`、`--model`、`--image-model`、`--reasoning`            |
| `models`                           | 查询可用于 `--model` 与 `--image-model` 的本地模型配置            | 无                                                                                                     |
| `projects [list]`                  | 查询当前 Workspace 的项目 ID 与名称 | 无 |
| `projects get <project-id>`        | 查询项目详情 | 无 |
| `projects create <name>`           | 创建普通项目 | `--description` |
| `projects update <project-id>`     | 修改项目名称或描述 | `--name`、`--description` |
| `projects delete <project-id>`     | 删除无持久关联的普通项目 | 必填 `--yes` |
| `doctor`                           | 只读核验 CLI 与运行中 App 的连接、身份和能力                      | `--pretty`                                                                                             |
| `list`                             | 查询已有会话                                                      | `--limit`、`--cursor`、`--search`、`--project`                                                         |
| `messages <conversation-id>`       | 按会话查询 durable 消息窗口                                       | `--limit`、`--before`、`--after`                                                                       |
| `status <conversation-id>`         | 查询当前或指定 root run 的状态                                    | `--run`、`--watch`、`--interval`、`--timeout`                                                          |
| `approvals <conversation-id>`      | 查询指定 run 及子树的 Shell 待处理请求                            | 必填 `--run`                                                                                           |
| `approval-reply <conversation-id>` | 精确回复 Shell 请求                                               | 必填 `--run`（请求实际 run）、`--request`、`--choice`                                                  |
| `resume <conversation-id>`         | 精确恢复一个已收口 `paused` 原 run                                | 必填 `--run`；可选 `--timeout`（毫秒，默认 60000）                                                     |
| `respond <conversation-id>`        | 回应当前 `awaiting_user` 交互并继续同一 run                       | `--interaction`，以及一个 response 选项                                                                |
| `stop <conversation-id>`           | 终止 foreground root run，并等待真实终态结算                      | `--run`、`--reason`、`--timeout`（毫秒，默认 60000）                                                   |
| `result <conversation-id>`         | 读取指定或最近 terminal root run 的最终回答                       | `--run`                                                                                                |
| `audit <conversation-id>`          | 只读导出统一 Audit Domain 的安全执行摘要                          | `--run`                                                                                                |
| `tools list`                       | 列出 CLI 允许调用的 Workspace 工具名称与简介                      | 无                                                                                                     |
| `tools describe <tool-name>`       | 查询一个 Workspace 工具的真实参数合同                             | 无                                                                                                     |
| `tools call <tool-name>`           | 在绑定项目的 Conversation 中执行一次 Workspace 工具调用并等待结果 | `--conversation`、`--project`、`--args-json` / `--args-file`、`--omit-args`、`--interval`、`--timeout` |

`messages` 的游标属于整个会话，所以不提供 `--run`
过滤。按 run 精确读取结果应使用 `result --run`；客户端先分页再过滤会让
`has_more` 与实际结果不一致。

向已有 `--conversation` 发送消息时，省略 `--agent`
会继承该会话保存的 Agent；显式传入才修改选择。新会话省略时仍走产品默认选择，不猜测 Slides。

读取请求与握手默认等待 5 秒，接纳/响应/恢复/工具调用默认等待 60 秒；`resume --timeout`
与 `stop --timeout`
分别控制恢复接纳和停止结算等待。stop 未传 run 时先选择并固定一个活跃 foreground
root
run；网络响应丢失最多重试一次，始终使用同一 run、共用等待预算。重查已终止 run 会返回其真实终态，不会误停同会话的新 run。只有 exact
stop 自动重试；send/respond/resume/approval-reply 不盲重试。resume 的 fence 在首次接纳后即失效，响应丢失时应先用 exact
status 确认新的 execution，不能重复发送或自动推进。超时仅表示结果尚未确认，不代表 App 没有执行；错误会给出精确重查命令。watch 超时也不会停止后端运行。

握手中的 capabilities 是可扩展的能力公告：同协议新增能力不影响已知命令，实际命令、响应和 schema/protocol 版本仍严格校验。

`send` 的单条消息上限是 200,000 个字符（按协议字符串长度计），由 App 握手的
`limits.max_message_chars` 正式声明。它只是 Conversation
CLI 的 Host 入口限制，不是 Linnkit 的 token 上限；最终模型输入仍由 Agent 的上下文预算统一计量和接纳。

`list` 不带 `--project` 时只查询无项目会话，不是全局列表。项目内会话必须先用
`projects` 取得项目 ID，再显式传入 `--project`；空结果不能证明其他项目没有会话。

### 独立文档评审

使用 `send --agent default --project <project-id> --model <model-config-id>`
在同项目的新会话中评价指定 Markdown。消息应明确目标、允许材料（或无）、读者、标准和新的评审输出路径，例如：

```bash
pnpm linnya:cli send "评价 workspace:/article.md。仅使用该正文，不联网或读取其他评审；目标读者为普通财经读者。逐项检查因果解释、限制条件与可读性，意见附正文原句，无法验证的事实标未验证。写入新的 workspace:/review-01.md，若已存在则换新文件名。写完回读确认。" --project <project-id> --agent default --model <model-config-id>
```

评价直接保存为 Markdown，使用普通文件工具显示和回读，不额外提交一份工具回执。新会话隔离生成对话的上下文，但不自动匿名，也不限制 Default
Agent 的联网或同项目文件访问权限；固定材料评审需在任务中声明范围，并用实际工具记录核查是否遵守。模型评价不等于事实核验。Benchmark 的运行采集与质量评价是两层：可用 Default
Agent 执行评审任务并保留会话，但普通评审文档不会自动进入 Benchmark，也不会自动变成质量分数；需显式关联被评正文版本和生成/评审运行。

### 3.1 调用工具

CLI 默认开放
`list_files / read_file / grep / write_file / edit_file`；Web 工具需显式开启。它不会接受 Shell、插件工具或任意注册工具。`tools list`
只返回名称与简介；需要调用时再用 `tools describe`
读取 App 当前注册的完整正式 schema，避免为发现工具反复传输全部参数合同：

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

`read_file` 的普通文本参数遵循 1-based 行窗口：`offset` 是起始行，`limit`
是最大行数；输出中的 `行号 |` 仅用于定位，编辑时不属于 `old_string`。结构化
`view="document"` 改用
`offset_chars/max_chars`。CLI 不重新解释这些字段，完整合同以
`tools describe read_file` 返回的 App 当前 schema 为准。

作用域规则只有三条：

- 只传 `--project`：创建一个绑定该项目、前端可见的新 Conversation，并返回
  `conversation_id`。
- 只传
  `--conversation`：从已有 Conversation 取得项目；不存在或未绑定项目时拒绝执行。
- 两者都传：验证 Conversation 确实属于该项目；不一致时拒绝执行。两者都不传同样拒绝。

`--args-file <path>` 从 UTF-8 JSON 文件读取整个工具参数对象，与 `--args-json`
互斥，适合大型 deck.js。`--omit-args`
只省略 CLI 回显中的工具入参，保留结果和诊断；不修改 App 历史。结果含 error 级文档诊断时也返回退出码
`8`，即使源码保存成功。

`tools call`
不调用 LLM。它仍通过正式 Flow、ToolNode、ToolContext、权限、审计、pending
revision 和 Conversation
UI 投影执行，因此前端能看到这次工具调用的历史，写入行为也与 Linnya
Agent 使用同一工具时完全一致。CLI 会等待 run 和工具卡都完成：工具成功时把完整工具消息写到 stdout；工具自身返回 error 时把同一消息写到 stderr，并以退出码
`8` 结束。

#### 临时开放 Web

```bash
pnpm linnya:cli tools web on
pnpm linnya:cli tools web status
pnpm linnya:cli tools describe web_search
pnpm linnya:cli tools call web_search --project <project-id> \
  --args-json '{"query":"primary source for the research question"}'
# 沿用上一条回执的 conversation_id，正式引用、Evidence 和长输出都归属于该会话。
pnpm linnya:cli tools call web_read --conversation <conversation-id> \
  --args-json '{"url":"https://example.org/article"}'
pnpm linnya:cli tools web off
```

开关只在当前 Host 内存中生效，重启后关闭；不修改普通 Agent 的工具或 Web 服务设置。
开启后，`list / describe / call` 可访问 `web_search / web_read / tool_output_read`；
关闭后隐藏并拒绝新的调用，已经接纳的运行正常完成或通过 `stop` 取消。
它是开发控制面的临时开放，不是同一系统用户之间的权限沙箱；所有连接同一 Host 的 CLI 共用该状态。

CLI 的 `web_search` 只允许普通搜索，`deep_search=true` 明确拒绝，以免启动使用 Linnya 模型额度的子运行。
外部 Agent 可自行执行多轮搜索和阅读。搜索服务仍使用当前 Linnya 配置，服务自身可能有费用。
现有 URL 安全、缓存、原文取得状态、引用与 Evidence 合同不变。

遇到正式 `observation_truncation` 时，用原会话调用 `tool_output_read`，按返回的
`blob_id / offset` 续读；不能只传项目新建会话，也不要把正文中的历史 blob 链接当作当前截断提示。
保存带引用的 Markdown 同样沿用该会话；只能引用工具实际返回的 `[@ref]`，不能自造来源编号。
这里只记录 Linnya 工具执行与产物，不会自动导入外部 Agent 的推理、模型 token 或评审记录。

工具命令自 wire protocol 5 起统一为 `tools`，当前项目管理合同使用 protocol 7。
CLI 与 Host 都要升级并重启 Host；旧协议会明确拒绝，不做双协议猜测。

外部 Agent 的 Skill 安装由该产品管理。可将内置 `deep-research` 及其 `references/` 原样复制到
外部产品支持的 Skill 目录，记录版本和文件哈希。资源读取和调用 Linnya CLI 的适配写在任务指令中，
不修改冻结的方法原文，也不把 OpenCode 等外部运行时接入生产 Agent 注册表。
例如 OpenCode 使用 `~/.config/opencode/skills/deep-research/SKILL.md`；任务明确要求先加载
`deep-research`，用其原生文件读取工具查看参考资源，再用 Linnya CLI 操作 Web 和 Workspace。
不要用 `send` 代替外部推理：`send` 会启动 Linnya 的 Agent 和模型，`tools call` 才是无模型工具入口。

### 3.2 与 Slides CLI 的区别

| 入口                                            | 适用调用方              | 当前职责                                                                            | 是否依赖正在运行的 Linnya                                            |
| ----------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `linnya ...`                                    | 外部 Agent、脚本、人    | 启动源码 Runtime、Conversation 控制，以及五个 Workspace 工具；可读写 `.slides` 源码 | 普通命令依赖 Desktop 或 CLI Runtime；`runtime start` 不依赖 Electron |
| `linnya-slides ...`                             | Linnya Agent 的 `shell` | 通过当前 Shell 的临时 bridge 执行 Slides `inspect / render / fonts`                 | 是，而且只能在受管 Shell execution 内使用                            |
| `pnpm slides:cli -- ...` / 插件 `entry.command` | 外部 Agent、人、CI      | Standalone Slides 只读诊断、检查图与字体查询                                        | 否；自行提供数据库和输出目录                                         |

`linnya-slides`
不是给外部进程直连 App 的通用命令：它依赖父 Shell 临时注入的 execution
token。外部 Agent 若只需要编辑当前 Linnya 项目，应使用
`linnya tools call`；若需要脱离 App 做 Slides 检查或渲染，应使用 Standalone
Slides CLI。两者当前没有相互转发。Slides CLI 的完整参数与运行环境见
[`presentationCli/README.md`](../../packages/plugins/slides/src/backend/features/presentationCli/README.md)。

`audit`
是查询和导出入口，不是审计 recorder；它不会写数据库、写文件或根据 CLI 参数开启另一种审计。从 RunRegistry 读取权威 run/Agent/终态，从统一 Audit
Domain 所写的 EventStore 配对 durable tool decision/output，并复用 Command
Audit 区分 Tool error 与 Shell 子进程非零退出。`tool_pairing.complete` 及
`paired / decision_missing / terminal_missing / duplicate_terminal`
可直接判断是否存在永久 loading 对应的事实缺口；realtime-only `tool_process`
不会被冒充为历史开始时间。模型、canonical token usage、工具耗时、context
compaction 与 run terminal 观测来自 Telemetry。压缩部分按 root / child
run 返回全部观测数、真实 Provider attempt 数、完成数和 Provider actual
usage 覆盖，并展示护栏、触发水位、前后 token、请求耗时与 cache read。每条明细的
`generation_attempted`
直接说明是否已经发出 Provider 请求；发送前的容量或护栏阻断仍计入观测与 outcome，但不计入
`attempts` 或 `missing_usage_calls`。run terminal 部分返回
`steps_used / max_steps / terminal_reason`。输出不包含 prompt、回答或摘要正文、工具参数、工具输出或原始错误正文。Telemetry 默认保留 7 天且写入失败不阻断任务，因此 Telemetry 部分明确标记为
`best_effort`；真实调用缺少 usage 时，`missing_usage_calls` 也不会被补成 0。

`llm_responses` 按 RunRegistry 的真实 root/child 范围返回已保存的 Provider attempt
结果：审计 event/envelope ID、attempt/trace/model ID、时间、outcome，以及失败的
`kind/code/retryable`。它不读取日志、模型正文或 Provider diagnostics。
`retryable` 只描述当次错误分类，不表示现在可重试；观测条数不是重试次数，历史最后一次
失败也不是当前暂停原因的证明。当前 response 事实没有 execution ID，输出明确标记
`execution_attribution=unavailable`，不能把恢复前后的 attempt 猜分到 execution。

这部分始终标记 `best_effort`：只有 response/stream 等级产生，保留 7 天，每 run 每次
execution 最多 64 条/1 MiB，且可能写入失败。没有记录的 run 标记 `evidence=unavailable`；
历史未开启、过期和容量丢弃无法从现有事实区分，`missing_or_dropped_attempts=unknown`，
不能把空列表解释成没有失败，也不能仅凭 64 条断言已触发上限。
新增的严格 audit 响应属于控制协议 4；CLI 与 Host 必须同版本，旧版本在握手前后明确拒绝，
不对已有 audit DTO 做宽松解析。

CLI 不负责开启或切换 Agent Run Audit 等级。开发环境的等级由 App 启动时的
`LINNYA_AUDIT_LEVEL=off|behavior|response|stream`
决定，修改后需要重启 App；CLI 只读取当前有效审计并导出安全摘要。生产 Desktop 不打包此 CLI，且生产 Host 固定关闭开发 Agent
Run Audit；即使外部自行运行 Node 版 CLI，也不能通过控制面开启审计，`audit`
能力不会在生产握手中声明。

## 4. 状态与控制语义

CLI 公开的运行状态是：

```text
pending -> running -> awaiting_user -> running -> completed | failed | cancelled
```

- 没有主动 `pause` 命令。
- `awaiting_user` 是 Runtime 被动等待，不是人为暂停；通过 `respond` 继续。
- `paused` 保留原 run 的断点，不是失败终态；已收口后可用 `resume --run`
  精确恢复。该命令复用原 `run_id / turn_id` 并取得新
  `execution_id`，不创建用户消息。`pause.reason=tool.protocol_fuse`
  表示连续工具参数错误；先查看最近工具错误，确认正确合同后再恢复。`tool_reconciliation_required`
  表示未知副作用需正式 owner 对账；恢复仍会被 Graph 对账门禁阻止，CLI 不重放调用或越过 owner。`execution_interrupted`
  则是未分类中断，需要进一步诊断。原因来自持久 RunRegistry，不解析日志或原始错误正文。
- `stop` 是唯一主动中断动作。它会等待 Host 的取消完成屏障，并返回真实的
  `cancelled`、`completed` 或 `failed`
  结算，避免把“已发取消请求”误报成“已经取消”。
- `command_approvals` 是 Commands owner 的实时等待投影，不把 Shell 等待伪装成
  `awaiting_user` checkpoint；工具和 run 的生命周期继续由各自 owner 结算。
- `status`
  不虚构百分比。生命周期来自 RunRegistry；运行中的节点与累计步数来自同一 activation 已持久化的 Graph 执行快照，交互、错误和结果可用性继续由各自 owner 投影。
- `send` 返回后该短命客户端可以退出，后台运行归当前 Desktop 或 CLI Runtime
  Host 所有。Runtime Host 自己退出时会收口其拥有的运行。

对已有会话执行 `send --conversation <id>` 时，如果该会话已有 active foreground
run，会得到 `conversation_busy`，不会并发写入第二条 foreground 主链。

后续新消息 `send --conversation <id> --project <project-id>`
必须再次指定项目，由 Host 校验与持久化绑定一致；不能借此迁移会话。审批
`respond <id>` 仍可继承项目；`resume` 使用原 run 的 durable
descriptor 与 checkpoint。历史无项目会话保留查询、结果导出和停止能力，但不能通过 CLI
`send` 继续发送。此限制属于 CLI 入口政策，不改变其他客户端的 Host wire
contract，也不借此调整全局工具权限。

## 5. 输出与退出码

普通成功命令向 stdout 写一个 JSON 值；`--pretty`
只改变普通命令的缩进。`status --watch` 向 stdout 写 JSONL，不能与 `--pretty`
组合。请求/传输失败向 stderr 写一个稳定 JSON 值；审批竞争的 `stale`
则保留 stdout 正式回执并退出 6：

```json
{
  "schema_version": 1,
  "ok": false,
  "command": "send",
  "error": { "code": "conversation_busy", "message": "...", "retryable": true }
}
```

退出码：

|  码 | 含义                                            |
| --: | ----------------------------------------------- |
| `0` | 成功                                            |
| `2` | 参数或请求合同错误                              |
| `3` | App 未运行、连接描述过期或本地传输失败          |
| `4` | CLI 与 App 协议不兼容                           |
| `5` | 未授权                                          |
| `6` | 目标或状态冲突，例如项目重名、不存在、busy、run/interaction 不匹配 |
| `7` | 当前 App 版本未提供请求的能力                   |
| `8` | Host 或 CLI 内部错误                            |

Benchmark 应把 CLI 当作子进程，解析 stdout 的 JSON/JSONL，并用退出码分类失败；不要复制 CLI 的连接协议，也不要直接访问数据库。

## 6. 本地连接与安全

Desktop 或 CLI Runtime 启动后原子发布当前实例的私有连接描述：

```text
~/.linnya/runtime/conversation-control-v1.json
```

测试或多实例隔离可以设置 `LINNYA_CLI_CONNECTION_FILE` 覆盖路径。目录权限为
`0700`，文件权限为
`0600`；文件包含 loopback 地址、实际端口、App 实例 ID 和随机 session
token。Host 正常退出会撤销自己发布的描述文件；异常终止后新 owner 会以 Workspace 排他锁和实例身份安全替换陈旧描述。

CLI token 只允许访问 `/api/v1/conversation-control/*`，Renderer
token 也不能访问该命名空间。token 在 body
parser 前校验，不写入普通日志。CLI 连接时还会校验协议版本、握手返回的 App 实例 ID 和能力上限，避免使用陈旧文件连到另一个进程。

## 7. CLI 自身怎么测试

日常修改至少运行：

```bash
pnpm typecheck:linnya-cli
pnpm test:linnya-cli
pnpm test:linnya-cli:bundle
pnpm test:linnya-runtime:e2e
```

测试按真实风险分层：

| 层                      | 证明什么                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| schema 合同             | 非法字段与组合被拒，状态、回执和错误 wire 保持 strict                                                                                            |
| parser / orchestration  | 命令映射、JSON 响应、退出码、watch 去重与停止条件正确                                                                                            |
| CLI 进程集成            | 真实 Node 子进程连接脚本化 HTTP bridge，验证 stdout/stderr、JSONL 和稳定退出码                                                                   |
| Project bridge 集成 | 真实 CLI → HTTP router → Project SQLite，覆盖空库读取、创建、修改、重名/不存在、写入事件与重开数据库 |
| Runtime 进程 E2E        | 构建后的 CLI → 固定 Node App Server → 临时 SQLite/Qdrant，验证无 Electron 冷启动、不同 Agent 并行、唯一 Workspace owner、正常/异常退出与历史重启 |
| Host use case 集成      | send durable acceptance、busy、HITL resume、stop settlement、run 精确结果读取                                                                    |
| ApiServer / bridge 集成 | token 双向隔离、loopback、描述文件权限和生命周期、稳定 HTTP 错误                                                                                 |
| 真实 App smoke          | 穿过实际 Linnya App、模型、Slides Agent 与 PPT 工具链，验证产品可用性                                                                            |

前三层不能替代 Host/bridge，Host/bridge 也不能替代真实模型 smoke。真实 App 验收建议按本 README
§2 跑一个 3 页 PPT，并传入专门用于验收的 Workspace
`--project`：保存回执，关闭首个 CLI 进程后继续 watch；若出现 `awaiting_user`
就 respond；完成后用同一 `run_id`
取 result。审批回归请求应明确包含“提交计划并等待确认”，用来验证 `--approve`
后 Agent 识别等待条件已经满足、不会重复索要同一确认。另补一个运行中 `stop --run`
场景，确认返回 terminal settlement。

## 8. 维护边界

- Wire DTO 与版本：`packages/schemas/src/conversation-control/`。
- 产品业务编排：`src/app-hosts/linnya/application/conversation-control/`。
- 模型运行可用性：`src/app-hosts/linnya/application/model-runtime-availability/`。
- 本地 HTTP、鉴权与连接描述：`src/app-hosts/linnya/adapters/conversation-control-bridge/`。
- 普通 CLI 命令只负责参数、连接、输出和 watch；Runtime
  launcher 只动态加载带版本的 Host
  bundle。两者都不能导入 Flow、数据库或 Electron 内部实现。

CLI 新能力应先成为 Host application use case 的窄 public
contract，再通过 bridge 暴露，最后接入命令；不能从 CLI 直接绕过现有控制面。

Workspace 五件套的参数、locator 与 pending revision 语义见
[`src/tools/workspace/README.md`](../../src/tools/workspace/README.md)。

写入后若构建失败，文档可能保存为 draft；`read_file` 的 `sourceOrigin: draft`
表示当前草稿源码，而版本 ID/编号仍对应最后成功 revision。这不代表成功构建；请结合 error
diagnostics 与 build failure 判断，并在修复后重新写入。

### 项目管理

先运行 `pnpm --silent linnya:cli projects`，从响应的 `projects[].project_id`
选择 `tools call --project` 或 `send --project`
的目标。裸 `projects` 等价于 `projects list`，空库返回空列表，不隐式创建默认项目。
生命周期由 Backend 的 [Project domain](../../src/domains/projects/README.md) 负责，CLI 不直接访问数据库。

`projects create <name> [--description TEXT]` 创建普通项目；`projects get <project-id>` 查询详情；
`projects update <project-id> [--name NAME] [--description TEXT]` 修改名称或描述。
名称去除首尾空白后必须非空，按现有数据库规则精确匹配重名。更新至少提供一个字段；
省略描述表示不修改，`--description=""` 或 `--description ''` 表示清空描述。

查询详情、创建和修改返回 `project`，含 `project_id`、名称、描述、图标、系统角色、`can_delete` 和时间戳，
不含数据库路径或软删除字段。创建不能指定系统角色；`can_delete` 沿用项目角色规则，
不代表项目没有关联内容。CLI 不提供 Workspace 创建/切换或隐式当前项目设置。

写入成功后通知 Desktop 刷新项目列表；当前导航、草稿和文档保持原状。重名返回
`project_name_conflict`，不存在返回 `project_not_found`，两者退出码均为 6；非法参数退出码为 2。
项目写入失败或响应丢失不会自动重试：先用 `projects list/get` 检查实际状态，再决定下一次操作。

当前 wire protocol 为 7：请求和响应都必须带 `action`，裸命令只在 CLI 参数层转为 `list`。
协议 7 新增确认后的空项目删除与对应错误；协议 6 的项目读写形态保持不变。
CLI 与 Host 必须同步升级，已有 Host 需要重启；不接受旧的无 action 请求，也不回退双协议。
真实链路测试位于 `src/app-hosts/linnya/adapters/conversation-control-bridge/__tests__/projectCliProcess.integration.test.ts`；
Runtime E2E 另验证空项目删除、有会话项目拒绝删除、重启后的项目与历史一致性。

`projects delete <project-id> --yes` 只删除无持久关联的普通项目。没有确认标志时在连接 Host 前拒绝；
命令没有 `--force`，不自动停止运行、不删除会话、文档或资产。系统默认项目禁止删除。
文件夹、软删除文档/待办、会话、知识库绑定、历史项目资产和已停用插件的持久关联均视为非空。
这些记录必须先通过各自 owner 的正式生命周期处理；仅把文档移入回收状态不会让项目变空。

删除成功返回 `action=delete` 与 `project_id`，随后查询该 ID 返回 `project_not_found`。
非空返回 `project_not_empty`；默认项目或持久化规则限制返回 `project_delete_blocked`，均退出 6。
响应丢失不自动重试，先 `projects get` 判断是否已完成。删除当前 Desktop 项目时回到 Assistant，
清理失效项目树；删除另一项目不切换当前导航。删除最后一个普通项目的通知刷新不会创建默认项目。

安全删除的事务与插件关联约束见 [Project domain](../../src/domains/projects/README.md#删除边界)。
Desktop 的历史删除入口仍保留原有级联语义，未把它伪装成完整跨域清理；CLI 不调用该入口。



## 用户 Skill 文件管理

`skills` 是追加能力，沿用当前协议的扩展 capability 握手；旧 Host 未公告时返回能力不可用。命令通过现有本机控制桥调用 Skills owner，不读取数据库，也不启动另一 Runtime。连接描述选择当前实例，来源目录在 CLI 转为本机绝对路径，由同机 Host 读取，无上传协议。

支持 `skills list`、`skills read NAME [PATH]`、`skills validate DIRECTORY`、`skills install NAME --from DIRECTORY`、`skills update NAME --from DIRECTORY` 和 `skills remove NAME`（也接受 uninstall）。升级会替换完整目录，包括本地改动，不保留历史；需要旧版就卸载后安装指定来源。

直接文件编辑用 `skills edit NAME [PATH] --old TEXT --new TEXT`；原文须唯一匹配。整文件写入用 `skills write NAME [PATH] --from FILE`，CLI 先读当前文件再提交原文条件，外部修改返回冲突（退出码 6）。新支持文件加 `--create`，目标已存在仍拒绝；支持文件删除用 `skills delete_file NAME PATH`。内置/插件来源只可读，不能写入。

错误沿用现有退出码：输入/内容错误 2，连接 3，协议 4，未授权 5，当前文件/目标冲突 6，能力不可用 7，内部失败 8。传输超时不自动重试写入；先检查当前文件。列表与读取返回严格 schema；升级和卸载没有撤销。Agent 的正式写入入口是 Default 专用 skill_manage，它使用冻结权限，不需要取得这个外部控制 CLI 的通用凭据。
