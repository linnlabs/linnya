# Knowledge 文档摄入

本目录拥有 Knowledge 文档从待处理到解析、向量化、存储和终态的流程，以及供 Renderer 推送与轮询使用的进度读模型。Knowledge 的总体边界见[上级 README](../README.md)；通用 Worker 队列只承载任务生命周期，不拥有摄入状态语义。

## 流程与状态

主流程为 `pending → parsing → embedding → storing → completed`，任一处理中阶段都可进入 `failed`，重复文件从 `pending` 进入 `duplicate`。

- `status` 是 Renderer 使用的五态：`pending | processing | completed | failed | duplicate`。
- `stage` 表示摄入内部阶段；`parsing`、`embedding`、`storing` 都映射为 `processing`。
- `stage_progress` 是 0–100 的阶段内进度。
- `progress` 是 0–100 的绝对进度。Backend 当前区间为 parsing 5–85、embedding 85–95、storing 95–100，终态完成或重复为 100。
- `updated_at` 是推送、轮询和 Renderer 去重使用的毫秒时间戳。

`IngestionProgressStore` 是 App Server 内的摄入进度读模型，并对绝对进度执行单调钳制。它不是持久化业务事实；终态快照过期后，`DocumentService.getTasksStatus()` 会回到文档元数据构造最小状态。

## 运行链路

Worker 模式：

1. `IngestionStateMachineManager` 根据状态机上下文生成 `IngestionFrontendState`。
2. Worker 把标准状态交给 `WorkerThreadQueue`；Knowledge 自有 projection 更新 `IngestionProgressStore`。
3. App Server 通过 Renderer integration port 发布 `task-status-update`，Electron Main 只负责 data-only 转发。

非 Worker 模式由注入的 `StatusUpdatePublisher` 发布同一类状态，不允许摄入代码直接依赖 Electron。Renderer 同时使用 push 和低频轮询；前端入口见 [Renderer Knowledge README](../../../../apps/renderer/domains/knowledgebase/README.md)。

## 修改地图

- `definitions/state.ts`、`definitions/stateMapping.ts`：状态、阶段、转换和进度区间的 Backend 真源。
- `stateMachine.ts`：状态转换与 `IngestionFrontendState` 生成。
- `IngestionStateMachineManager.ts`：Handler 装配、节流、读模型更新和 Worker/Publisher 分流。
- `handlers/`：各阶段业务；只维护本阶段工作和 `stageProgress`。
- `store/ingestionProgressStore.ts`：轮询读模型与进度单调性。
- `orchestration/workerIngestionProgressProjection.ts`：Worker 状态到 Knowledge 读模型的投影。
- `orchestration/statusUpdatePublisher.ts`：摄入状态到 Renderer push payload 的投影。
- `../application/services/IngestionService.ts`：任务提交与队列接入。
- `../application/services/DocumentService.ts`：轮询状态读取。

## 当前未收口的漂移

Backend 已输出绝对 `progress`，但 Renderer 的 `statusSync.js` 对已知 processing stage 仍通过 `constants/index.js` 中的 `KB_UPLOAD_STAGES` 重新计算进度。Backend 的 parsing/embedding 分界是 85%，Renderer 当前是 80%，因此 `progress` 尚未成为端到端唯一进度真源。修改阶段比例、删除前端映射或调整轮询逻辑时，必须同时核对 Backend push、轮询和 Renderer 动画，不能只改一侧。

## 验证

从仓库根执行：

```bash
pnpm vitest run \
  src/features/knowledge-base/ingestion/__tests__/workerIngestionProgressProjection.test.ts \
  src/features/knowledge-base/ingestion/__tests__/workerQueueProgressBoundary.integration.test.ts \
  src/features/knowledge-base/ingestion/orchestration/statusUpdatePublisher.test.ts
```

测试应覆盖五态、终态不可逆、绝对进度单调、Worker/非 Worker 投影以及 push/轮询一致性；不要用快照锁定 README 或展示文案。
