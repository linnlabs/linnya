# 文档摄入状态与进度统一方案（设计说明）

## 1. 目标
- 统一“状态（status）/阶段（stage）/进度（progress, stage_progress）”的数据模型与传递链路。
- 消除进度倒退、阶段名不一致、IPC/轮询不一致、前端映射混乱等问题。
- 保持现有模块（状态机、队列、IPC、前端）最小侵入升级。

## 2. 现状梳理（当前链路）

### 2.1 参与模块
- knowledge-base 模块（状态机域）：
  - `IngestionStateMachineManager`：
    - 监听内部状态变化（四个 Handler：Pending/Parsing/Embedding/Storing）。
    - 生成 `frontendState`（status/stage/progress/stage_progress/updated_at）。
    - 更新 `TaskStateStore`；（在 Worker 时）通过 Worker → QueueManager → 注入的 Renderer integration port 推送进度。
  - 四个 Handler：
    - `PendingHandler`：重复检测、初始化。
    - `ParsingHandler`：解析、调用 `parser.parse`（多层策略，带细分进度回调）、后处理。
    - `EmbeddingHandler`：向量化（批次处理，内部维护阶段进度）。
    - `StoringHandler`：持久化写入、最终完成。

- task-queue 模块：
  - `WorkerThreadQueue`：Worker 线程管理，接收 Worker 消息并发出 `taskProgress/taskCompleted/taskFailed` 事件。
  - `QueueJobPresentationPublisher`：QueueManager 只发布通用 job 事实，不依赖 Electron；Desktop adapter 保持 `task-status-update` channel/payload。
  - `TaskStateStore`：主进程内存态（已存 doc_id/filename/status/message/error/updated_at；将扩展保存 progress/stage/stage_progress）。

- parser 模块：
  - `PdfParser` 三层策略（文本提取/几何分析/视觉识别）内部也有进度回调，但应仅供 `ParsingHandler` 消费并折算为阶段内进度。

- 前端（renderer）：
  - `ipcBridge.js`：注册 `task-status-update` 监听，分发到 Store。
  - `statusSync.js`：
    - 去重（基于 updated_at）。
    - 进度映射（stage→绝对进度）；已改为 stage 未知或为 processing 时使用 progress 兜底。
    - Watchdog（轮询 `getTasksStatus`）。

### 2.2 数据通道
- Worker 情况：
  1) 状态机 → `frontendState` → `Worker.postMessage` → 主进程 `WorkerThreadQueue.handleWorkerMessage`。
  2) `QueueJobPresentationPublisher` → Backend Renderer integration → 渲染端 `ipcBridge` → Store `statusSync`。
  3) 同时主进程写入 `TaskStateStore`，供轮询使用。
- 非 Worker 情况（同步模式/兜底）：
  - `IngestionStateMachineManager.sendIpcStatusUpdate` → 注入的 `StatusUpdatePublisher` → Backend Renderer integration；同时写入 `TaskStateStore`。
- 轮询：
  - `KnowledgeBaseRouter.get('/knowledge-base/tasks/status')` → `KnowledgeBaseService.getTasksStatus` → `DocumentService.getTasksStatus` → 读取 `TaskStateStore` 汇总视图并返回。

## 3. 主要问题
- 状态与阶段混用：曾出现 `stage='processing'` 导致前端映射报“未知阶段”。
- 绝对进度不严格单调：阶段切换或回调重入造成倒退。
- IPC/轮询字段不对齐：轮询曾把 `stage=processing` 回传给前端。
- 多处负责推送：状态机、队列、解析器都有日志或回调，管理分散易错。

## 4. 统一数据契约（后端权威）
- status（五态，仅此五个）：
  - `pending` | `processing` | `completed` | `failed` | `duplicate`
- stage（仅用于 processing 内部文案与进度折算）：
  - `parsing` | `embedding` | `storing` | `completed` | ''（空字符串）
  - 禁止推送 `stage='processing'`
- stage_progress：0-100，仅在 `parsing/embedding/storing` 有效。
- progress：0-100 绝对进度，必须单调不减；映射区间：
  - pending: 0-5
  - parsing: 5-85
  - embedding: 85-95
  - storing: 95-100
  - completed: 100
- 时间戳：统一 `updated_at`（毫秒），用于前端去重与 Watchdog。

## 5. 改造方案

### 5.1 后端（必须）
1) IngestionStateMachineManager（统一出口）：
   - 在 `createFrontendState` 计算出绝对进度后，进行“单调钳制”。可通过：
     - 读取 `TaskStateStore` 中该 docId 上一次 `progress`，若新值更小，则取旧值。
   - 始终推送契约字段：status / stage / stage_progress / progress / updated_at。
   - 禁止推送 `stage='processing'`；无具体阶段则置空字符串。

2) TaskStateStore：
   - 扩展结构保存：progress（number 0-100）、stage（string）、stage_progress（number）。
   - 每次写入进行单调钳制，确保后续轮询/前端看到的一致为“最大已知进度”。

3) DocumentService.getTasksStatus（轮询视图）：
   - 直接返回 `TaskStateStore` 的权威字段：status/progress/stage/stage_progress/updated_at。
   - 若无任务状态（历史/已清理），从 metadata 回落，仅在 completed 时返回 `stage='completed'`，其余为空。

4) Handler 进度回调（ParsingHandler/EmbeddingHandler/...）：
   - 只更新“阶段内进度”，交由 `IngestionStateMachineManager` 统一折算为绝对进度。
   - 阶段切换时确保 `stage_progress` 从 0 开始，避免跨阶段回退。

### 5.2 前端（简化）
1) 显示规则：
   - 始终以 `status` 五态为主（pending / processing / completed / failed / duplicate）。
   - 进度条直接使用 `progress`；若无 `progress`（极少数异常），再考虑 `stage + stage_progress` 映射。
   - 文案：processing + （parsing/embedding/storing）对应提示；无阶段时使用“处理中”。

2) Watchdog：
   - 校准使用轮询返回的 `progress`，不再自行做阶段映射。

## 6. 代码改动清单（分步可回滚）
- 后端
  - [ ] `src/task-queue/taskStateStore.ts`：扩展结构（progress/stage/stage_progress），写入时做单调钳制。
  - [ ] `src/knowledge-base/ingestion/IngestionStateMachineManager.ts`：
    - 统一封装 `emitFrontendState(context, stage)`：内部折算绝对进度→钳制→更新 TaskStateStore→（Worker 或兜底）IPC 推送。
    - 严格输出契约字段。
  - [ ] `src/knowledge-base/application/services/DocumentService.ts`：轮询视图使用 TaskStateStore 的权威值；仅 completed 时返回 `stage='completed'`。
  - [ ] Handlers（`ParsingHandler`/`EmbeddingHandler`/`StoringHandler`）：仅设置阶段与阶段内进度，不计算绝对进度。

- 前端
  - [ ] `apps/renderer/.../statusSync.js`：
    - 收到状态更新：优先直接使用 `progress`。
    - 去重仍基于 `updated_at`。
  - [ ] `apps/renderer/.../ipcBridge.js`：保持现状，仅加强日志。

## 7. 风险与回滚
- 变化点集中在后端状态统一出口与 TaskStateStore；如出现异常，可快速回滚到仅前端兜底的实现（已部署）。

## 8. 验收标准
- 进度单调不减（日志验证 + 前端观察）。
- 不再出现“未知阶段”告警；轮询/IPC 显示一致。
- 大 PDF（含视觉识别）阶段切换平滑（5→85→95→100）。

## 9. 后续优化（可选）
- 将阶段区间配置化（不同文件类型可调比例）。
- 在 `ParsingHandler` 中按页更细化进度（长文更平滑）。
- 将状态机与进度映射写单元测试（确保单调与区间一致）。
