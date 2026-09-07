# Conversation Control Use Case

本 feature 是 Linnya Conversation 外部控制动作的产品级 use case。它把 `send / models / list / messages / status / respond / stop / result / audit / workspace_tools` 编排到现有模型目录、Flow、run registry、durable history、工具目录和执行审计 ports，供 CLI 等入口复用。

它不拥有 HTTP、鉴权、命令行解析、数据库 SQL 或 Agent runtime。共享 wire 合同位于 `packages/schemas/src/conversation-control/`；本地传输位于 `adapters/conversation-control-bridge/`。

## 所有权与 ports

| port | owner 能力 |
| --- | --- |
| `ConversationControlFlowPort` | 接纳新运行、提交 HITL 响应、执行终止与完成屏障 |
| `ConversationControlRunPort` | 查询 canonical run registry |
| `ConversationControlExecutionProgressPort` | 读取 Graph 已持久化的当前节点与当前 execution 步数；终态 checkpoint 清理后可从生命周期 telemetry 读取最近一次 execution 步数 |
| `ConversationControlModelCatalogPort` | 查询安全模型投影，并按统一运行可用性规则校验显式 Chat/图片模型 |
| `ConversationControlHistoryPort` | 会话列表、消息窗口、指定 run 最终回答、会话 Agent 选择 |
| `ConversationControlWorkspaceToolCatalogPort` | 只读取五个获准 Workspace 工具的正式描述与参数 schema |
| `ExecutionAuditExportUseCase` | 关联 RunRegistry、EventStore、Command Audit 与 Telemetry 的安全只读执行摘要 |

use case 只依赖这些窄接口，不导入 Express、Electron route 或 SQLite 实现。跨 domain 的具体组合在 `adapters/conversation-control-bridge/orchestration/createLinnyaConversationControlUseCase.ts` 完成。

## 关键语义

- `models` 返回已经物化的 Chat 与图片生成模型；`model_config_id` 是 `send --model / --image-model` 接受的精确身份。输出不含 route、credential reference 或 secret，并分别保留用户图片与工具结果图片能力。
- `send` 先用与 `models` 相同的规则校验显式 Chat/图片模型，再拒绝已有 active foreground root run、保存显式 Agent 选择并进入正式 Flow admission；不存在、用途错误、缺 route 或缺凭据必须在任何持久化或 Flow side effect 前失败。
- `image_generation_model_id` 是单次请求覆盖项，只映射到现有 Flow request，不拥有或修改 Renderer 的全局图片模型偏好。
- `send` 的 success receipt 必须包含 durable committed user message identity 和 Host 接纳的 `turn_id / run_id / execution_id`。回执不代表运行完成。
- `send / respond / workspace_tools call` 共用历史项目解析：已有会话省略项目时继承持久化绑定，显式项目必须与绑定一致，不存在的会话拒绝。无项目会话可继续聊天/审批，但不能调用 Workspace 工具；CLI 不负责迁移会话项目。解析出的项目同时进入 Flow 的 project identity 与 project metadata。
- `respond` 只接纳当前 `awaiting_user` 的 exact `interaction_id`，继续同一个 `run_id`，并产生新的 `execution_id`；恢复时必须从 run 的 `agentSpecId` 还原原 Agent 路由，不能回退到 default。
- CLI use case 只投影响应事实，不拥有 Agent 提示语。`approved` 的模型可见语义由 Flow Host 在创建 committed `tool_output` 时统一补足，因此 Renderer 与 CLI 必须得到相同的恢复行为。
- `stop` 是唯一主动中断动作。它调用 Flow 的取消完成屏障，并重新读取 registry 验证 terminal settlement；不公开主动暂停。
- 历史 `paused` 状态不属于当前产品合同，遇到时明确返回 `unsupported_runtime_state`，不能伪装成 `awaiting_user`。
- `status` 以 RunRegistry 作为生命周期 owner；`run_iterations_used`（以及兼容字段 `iterations_used`）表示同一逻辑 run 跨 execution 的累计步数。仅在 `running` 时，用不早于本次 activation 的 Graph 持久执行快照补充 `execution_steps_used`，不计算虚构百分比。`awaiting_user` 时仍从 durable message window 读取 pending interaction，恢复前的旧 checkpoint 不能覆盖新 execution。
- `messages` 使用会话级 read-model 游标，不支持 run 过滤，以保持 `has_more` 和游标语义一致。
- `result --run` 先选择 exact terminal root run，再读取归属于该 run 的 durable `final_answer`。完成终态与 read-model 投影可能短暂不同步，此时显式返回 `projection_preparing`。
- `audit` 只委托通用执行审计摘要 use case；RunRegistry 是生命周期 owner，EventStore
  提供完整 durable tool decision/output，Command Audit 提供 Shell 进程终态，Telemetry
  仅按 `best_effort` 聚合 LLM、tool、context compaction 与 run terminal 观测。输出不含
  prompt、摘要正文、工具参数、工具输出或原始错误正文。
- `workspace_tools` 是固定五工具的窄入口：`list_files / read_file / grep / write_file / edit_file`。`list / describe` 读取真实 Tool registry schema；`call` 必须绑定项目或已有 Conversation，并复用正式 Flow admission 与 ToolNode 执行。
- 只给项目时创建前端可见的新 Conversation；只给 Conversation 时从历史 owner 解析项目；同时提供时必须一致。Workspace locator 本身不携带项目身份，禁止按当前前端页面或文件存在性猜测作用域。
- Host 工具请求使用 `yield_after_batch`：完整工具批次结算后结束 run，不调用 LLM。工具 decision/output、权限、审计、pending revision 与 UI projection 仍走普通工具链，不能在本 feature 复制 Workspace 执行逻辑。

## 并发与已知边界

Flow admission 和 run registry 是并发控制的最终 owner。use case 的 busy precheck 用于给调用方更清楚的产品错误，不能替代 owner admission。

当前显式 Agent 选择写入发生在 Flow admission 前。极少数跨入口竞争中，如果 precheck 后另一个 foreground run 先被接纳，失败请求仍可能已经更新会话的后续 Agent 偏好，但不会创建第二条 active foreground 主链。若未来要求“选择偏好与运行接纳完全原子”，应由 Conversation admission owner 提供同事务 port，不能在本 use case 增加补偿式回滚。

## 测试

```bash
pnpm exec vitest run \
  src/app-hosts/linnya/application/conversation-control/__tests__/conversationControlUseCase.integration.test.ts
```

集成测试使用窄 ports 穿过真实 use case，覆盖 durable acceptance、active-run 冲突、`awaiting_user` exact interaction resume、stop terminal settlement、exact-run result、安全 audit 投影，以及 Workspace 工具的 allowlist、项目作用域与 Host 请求。执行摘要自身的父子 run scope、token 可信度和工具失败聚合由 `application/execution-audit-export/__tests__/` 覆盖；字段严格性由 `packages/schemas/src/conversation-control/conversation-control.test.ts` 负责。Flow 的交互响应测试还必须验证 `approved` 已被投影为“等待条件已满足”的自包含 observation，不能只断言状态枚举和 JSON payload。

CLI 使用方法和端到端测试分层见 `apps/linnya-cli/README.md`。
