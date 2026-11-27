/**
 * @file packages/plugins/knowledge/src/backend/graph/application/knowledgeGraphQueueOrchestrator.ts
 *
 * @description
 * 软知识图谱的“队列编排器”（feature 层）：
 * - 订阅 task-queue 的通用事件（ingestion/graphExtraction）；
 * - 负责何时入队图谱抽取、如何回填历史文档、如何选用文本模型；
 * - 负责 KB 级图谱进度聚合与 IPC 推送（GraphProgressService）。
 *
 * 重要设计约束：
 * - task-queue 必须保持通用，不允许把 KB/SoT/graph 表逻辑写进 queues.ts；
 * - 领域逻辑集中在 features/knowledge-base/graph 下（高内聚、低耦合）。
 */

import { Logger } from '@plugin/backend/loggingRuntime';
import { createKnowledgeJobId as generateTaskId } from '../../queue/functions/createKnowledgeJobId';
import { FileSotRepository } from '../../infrastructure/sotRepository';
import { BetterSqliteMetadataRepository } from '../../infrastructure/sqlite/better-sqlite-metadata.repository';
import { DocumentStatus } from '../../domain/document';
import type { DocumentSoT } from '../../domain/block';
import { collectExtractableTextBlocks } from './extractableBlocks';
import { BetterSqliteKnowledgeGraphRepository } from '../infrastructure/better-sqlite-knowledge-graph.repository';
import { GraphProgressService, type KbGraphProgressPayload } from './graphProgressService';
import type {
  GraphExtractionJobPayloadInput,
  GraphIndexingJobPayloadInput,
} from '../../queue/definitions/jobs';
import type { KnowledgeQueues } from '../../queue/orchestration/KnowledgeQueues';
import type { KnowledgeExecution } from '../../runtime/definitions/knowledgeExecution';
import type { KnowledgeDatabase } from '../../definitions/knowledgeDatabase';
import {
  getGraphEdgesCollectionName,
  getGraphNodesCollectionName,
} from '../infrastructure/qdrantCollections';
import { KNOWLEDGE_GRAPH_DOCUMENT_MAX_RETRIES } from '../definitions/extractionRetryPolicy';

type MaybeKbIdCarrier = { kbId?: unknown } | null;

function readStringField(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** 回填范围：省略 kbId 表示本次运行扫描全部开了图谱的知识库。 */
interface GraphBackfillScope {
  readonly kbId?: string;
  /** 触发这次回填的界面请求带来的图谱抽取模型；为空时只补图谱向量索引。 */
  readonly llmModelId: string | null;
}

export class KnowledgeGraphQueueOrchestrator {
  private readonly logger = new Logger('KnowledgeGraphQueueOrchestrator');
  private readonly queueManager: KnowledgeQueues;
  private readonly metadataRepo: BetterSqliteMetadataRepository;
  private readonly graphRepo: BetterSqliteKnowledgeGraphRepository;
  private readonly sotRepo: FileSotRepository;
  private readonly graphProgressService: GraphProgressService;
  private started = false;
  private stopped = false;
  private readonly subscriptions: Array<() => void> = [];
  // 图谱抽取模型只保存在界面里，Host 不发布默认（用户 2026-11-27 定：补抽取用界面当前模型）。
  // 所以全库回填分两档：没有模型时只补向量索引；之后第一次带模型的界面操作再整体补抽取一次。
  private indexBackfillStarted = false;
  private extractionBackfillStarted = false;
  // 回填依次执行：“队列里是否已有该文档任务”的检查与入队之间有等待，两轮并行会重复入队。
  private backfillChain: Promise<void> = Promise.resolve();
  private readonly pendingOperations = new Set<Promise<void>>();

  /**
   * 图谱抽取失败后的“自动重试状态”（仅驻留内存）
   *
   * 设计目标：
   * - 用户不需要在前端点“重试”按钮；
   * - 对网络/对端抖动等可恢复错误做自动重试（有限次数 + 退避）；
   * - 对 schema/json 等不可恢复错误不做无意义重试（避免 token 浪费）。
   *
   * 注意：
   * - 这是“运行期自动修复”，重启后仍可由 backfill 兜底（failed doc 会被重新入队）；
   * - 我们只在编排器里做领域相关判定，避免把 KB 逻辑塞到通用队列里。
   */
  private readonly graphExtractionRetryState = new Map<
    string,
    { attempts: number; timer: ReturnType<typeof setTimeout> | null; release?: () => void }
  >();

  constructor(deps: {
    queueManager: KnowledgeQueues;
    database: KnowledgeDatabase;
    sotRepository: FileSotRepository;
    publishGraphProgress(payload: KbGraphProgressPayload): void;
  }) {
    this.queueManager = deps.queueManager;
    this.metadataRepo = new BetterSqliteMetadataRepository(deps.database);
    this.graphRepo = new BetterSqliteKnowledgeGraphRepository(deps.database);
    this.sotRepo = deps.sotRepository;
    this.graphProgressService = new GraphProgressService(this.graphRepo, {
      throttleMs: 250,
      onProgressUpdated: deps.publishGraphProgress,
    });
  }

  /**
   * 启动编排（只应调用一次）
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    this.logger.info('启动：准备订阅队列事件（ingestion/graphExtraction）');

    // 1) ingestion 完成后自动入队图谱抽取
    this.subscriptions.push(
      this.queueManager.subscribeToEvent('ingestion:taskCompleted', ({ taskId }) => {
        this.logger.info(
          `收到 ingestion:taskCompleted，尝试触发图谱抽取入队: ingestionTaskId=${taskId}`
        );
        const execution = this.queueManager.getExecution(taskId);
        this.runBackground(this.tryEnqueueAfterIngestion(taskId, execution), '摄入完成后图谱抽取入队失败', execution);
      })
    );

    // 2) graphExtraction 进度/完成触发 KB 级进度聚合
    this.subscriptions.push(
      this.queueManager.subscribeToEvent('graphExtraction:taskProgress', ({ data }) => {
        const kbId = readStringField(data as MaybeKbIdCarrier, 'kbId');
        if (kbId) this.graphProgressService.onDocProgress(kbId);
      })
    );
    this.subscriptions.push(
      this.queueManager.subscribeToEvent('graphExtraction:taskCompleted', ({ taskId, result }) => {
        const execution = this.queueManager.getExecution(taskId);
        const kbId = readStringField(result as MaybeKbIdCarrier, 'kbId');
        const docId = readStringField(result as MaybeKbIdCarrier, 'docId');
        if (kbId) this.graphProgressService.onDocProgress(kbId);

        // 抽取完成后：尝试触发“图谱向量索引”（不阻塞抽取完成）
        if (kbId && docId) {
          this.runBackground(
            this.tryEnqueueIndexingAfterGraphExtraction(kbId, docId, execution),
            `抽取完成后图谱索引入队失败: kbId=${kbId}, docId=${docId}`,
            execution
          );
        }
      })
    );

    this.subscriptions.push(
      this.queueManager.subscribeToEvent('graphExtraction:taskFailed', ({ taskId, error }) => {
        const execution = this.queueManager.getExecution(taskId);
        this.logger.warn(
          `graphExtraction:taskFailed: taskId=${taskId}${error ? `, error=${error}` : ''}`
        );
        this.runBackground(
          this.tryAutoRetryGraphExtraction(taskId, error, execution),
          `图谱抽取重试调度失败: taskId=${taskId}`,
          execution
        );
      })
    );

    // 2.5) graphIndexing 进度/完成仅用于观测（后续可接入 UI）
    this.subscriptions.push(
      this.queueManager.subscribeToEvent('graphIndexing:taskProgress', ({ data }) => {
        const kbId = readStringField(data as MaybeKbIdCarrier, 'kbId');
        const docId = readStringField(data as MaybeKbIdCarrier, 'docId');
        if (kbId && docId) {
          this.logger.info(`graphIndexing:taskProgress: kbId=${kbId}, docId=${docId}`);
          // ✅ 端到端进度：索引阶段也要触发 KB 聚合刷新，否则 UI 会在“写向量”阶段停住
          this.graphProgressService.onDocProgress(kbId);
        }
      })
    );
    this.subscriptions.push(
      this.queueManager.subscribeToEvent('graphIndexing:taskCompleted', ({ result }) => {
        const kbId = readStringField(result as MaybeKbIdCarrier, 'kbId');
        const docId = readStringField(result as MaybeKbIdCarrier, 'docId');
        if (kbId && docId) {
          this.logger.info(`graphIndexing:taskCompleted: kbId=${kbId}, docId=${docId}`);
          this.graphProgressService.onDocProgress(kbId);
        }
      })
    );
    this.subscriptions.push(
      this.queueManager.subscribeToEvent('graphIndexing:taskFailed', ({ taskId, error }) => {
        this.logger.warn(
          `graphIndexing:taskFailed: taskId=${taskId}${error ? `, error=${error}` : ''}`
        );
        // 失败同样触发刷新：确保 KB 进度不会错误地显示为 100%
        const payload = this.findGraphIndexingTaskPayload(taskId);
        const kbId = readStringField(payload as MaybeKbIdCarrier, 'kbId');
        if (kbId) this.graphProgressService.onDocProgress(kbId);
      })
    );

    // 历史图谱补齐由界面实际向量操作触发；普通启动及项目 CLI 只注册监听。

    this.logger.info('✅ 已启动图谱队列编排器（自动入队 + 回填 + 进度推送）');
  }

  private runBackground(operation: Promise<void>, diagnostic: string, execution?: KnowledgeExecution): void {
    execution?.track(operation);
    const pending = operation
      .catch(error => this.logger.warn(diagnostic, error))
      .finally(() => this.pendingOperations.delete(pending));
    this.pendingOperations.add(pending);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const state of this.graphExtractionRetryState.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.release?.();
    }
    this.graphExtractionRetryState.clear();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.graphProgressService.dispose();
    await Promise.all(this.pendingOperations);
  }

  private isRetriableGraphExtractionError(error?: string): boolean {
    const msg = typeof error === 'string' ? error : '';
    if (msg.length === 0) return false;

    // 数据前置条件错误：重试无意义
    if (msg.includes('SoT 不存在')) return false;
    if (msg.includes('文档不存在或不属于该知识库')) return false;

    // 真实线上出现过：TypeError: fetch failed (cause: HeadersTimeoutError)
    if (msg.includes('fetch failed')) return true;
    if (msg.includes('HeadersTimeoutError')) return true;
    if (msg.includes('Headers Timeout')) return true;
    if (msg.includes('UND_ERR_HEADERS_TIMEOUT')) return true;

    // 兜底：超时类（保持克制，避免把业务错误当成可重试）
    if (msg.includes('timeout') || msg.includes('Timeout')) return true;

    // 结构抖动：JSON / schema / chunk_id 覆盖不全（通常重试即可恢复）
    if (msg.includes('Unexpected non-whitespace character after JSON')) return true;
    // ✅ 输出截断/JSON 数组不完整：常见于 fallback 模型触发 token 上限（finish_reason=length）
    if (msg.includes('JSON 数组不完整')) return true;
    if (msg.includes('无法找到匹配的 "]"')) return true;
    if (msg.includes('LLM 输出不包含可解析的 JSON 数组')) return true;
    if (msg.includes('未覆盖全部 chunk_id')) return true;
    if (msg.includes('LLM 输出未覆盖全部 chunk_id')) return true;
    if (msg.includes('ZodError')) return true;

    return false;
  }

  private findGraphExtractionTaskPayload(taskId: string): GraphExtractionJobPayloadInput | null {
    const tasks = this.queueManager.listGraphExtractionTasks();
    const found = tasks.find(t => t.id === taskId);
    if (!found) return null;
    return found.data ?? null;
  }

  private findGraphIndexingTaskPayload(taskId: string): GraphIndexingJobPayloadInput | null {
    const tasks = this.queueManager.listGraphIndexingTasks();
    const found = tasks.find(t => t.id === taskId);
    if (!found) return null;
    return found.data ?? null;
  }

  private getRetryKey(kbId: string, docId: string): string {
    return `${kbId}::${docId}`;
  }

  private clearRetryTimer(kbId: string, docId: string): void {
    const key = this.getRetryKey(kbId, docId);
    const state = this.graphExtractionRetryState.get(key);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    state.release?.();
    this.graphExtractionRetryState.delete(key);
  }

  /**
   * 图谱抽取失败后的自动重试（运行期）
   *
   * 触发条件：
   * - 任务失败，且 error 判定为“可恢复网络错误”；
   * - KB 未关闭图谱构建；
   * - 当前 doc 未处于 extractionQueue 的 RUNNING/PENDING（避免重复入队）。
   */
  private async tryAutoRetryGraphExtraction(taskId: string, error?: string, execution?: KnowledgeExecution): Promise<void> {
    if (execution?.signal.aborted || this.stopped) return;
    if (!this.isRetriableGraphExtractionError(error)) return;

    const payload = this.findGraphExtractionTaskPayload(taskId);
    const kbId = readStringField(payload as MaybeKbIdCarrier, 'kbId');
    const docId = readStringField(payload as MaybeKbIdCarrier, 'docId');
    if (!kbId || !docId) return;
    const retryLlmModelId = readStringField(payload, 'llmModelId');

    // 关闭开关后不做自动重试
    const enabled = await this.isGraphIndexingEnabledForKb(kbId);
    if (!enabled) {
      this.clearRetryTimer(kbId, docId);
      return;
    }

    // 如果队列里已经有该 doc 的任务（例如用户手动触发了回填），不要重复重试
    if (this.hasGraphExtractionTaskForDoc(kbId, docId)) return;

    // 若 doc 已经完成（可能是“失败事件晚到/重复事件”），不再重试
    const existing = await this.graphRepo.getDocStatus(kbId, docId);
    if (existing && existing.status === 'completed' && existing.doneChunks >= existing.chunkCount) {
      this.clearRetryTimer(kbId, docId);
      return;
    }

    const key = this.getRetryKey(kbId, docId);
    const current = this.graphExtractionRetryState.get(key) ?? { attempts: 0, timer: null };
    if (current.timer) return; // 已安排过重试

    const nextAttempt = current.attempts + 1;
    // 与“模型重试策略”一致：运行期 doc 级自动重试也限制为 3 次，避免无限烧 token
    const maxAttempts = KNOWLEDGE_GRAPH_DOCUMENT_MAX_RETRIES;
    if (nextAttempt > maxAttempts) {
      this.logger.warn(
        `自动重试次数已达上限，将不再重试: kbId=${kbId}, docId=${docId}, maxAttempts=${maxAttempts}`
      );
      this.clearRetryTimer(kbId, docId);
      return;
    }

    // 指数退避：30s, 60s, 120s, 240s, 480s（上限 15min）
    const baseMs = 30_000;
    const backoffMs = Math.min(15 * 60_000, baseMs * Math.pow(2, nextAttempt - 1));
    const jitterMs = Math.floor(Math.random() * 1500);
    const waitMs = backoffMs + jitterMs;

    this.logger.warn(
      `图谱抽取失败（可恢复），将自动重试: kbId=${kbId}, docId=${docId}, attempt=${nextAttempt}/${maxAttempts}, waitMs=${waitMs}`
    );

    let releaseWait: () => void = () => {};
    if (execution) execution.track(new Promise<void>(resolve => { releaseWait = resolve; }));
    const release = () => {
      execution?.signal.removeEventListener('abort', cancelRetry);
      releaseWait();
    };
    const cancelRetry = () => this.clearRetryTimer(kbId, docId);
    const timer = setTimeout(() => {
      this.runBackground(
        (async () => {
          execution?.signal.throwIfAborted();
          // 触发时再检查一次开关与队列状态
          const enabledNow = await this.isGraphIndexingEnabledForKb(kbId);
          if (!enabledNow) {
            this.clearRetryTimer(kbId, docId);
            return;
          }
          if (this.hasGraphExtractionTaskForDoc(kbId, docId)) {
            this.clearRetryTimer(kbId, docId);
            return;
          }

          // 读取 SoT 计算 chunkCount，用于进度聚合与 payload 准确性
          const sot = (await this.sotRepo.get(docId)) as DocumentSoT | null;
          if (!sot) {
            this.logger.warn(
              `自动重试放弃：SoT 不存在（可能已被删除）: kbId=${kbId}, docId=${docId}`
            );
            this.clearRetryTimer(kbId, docId);
            return;
          }
          const chunkCount = collectExtractableTextBlocks(sot).length;

          // 入队前先写 queued，确保进度聚合能“看到分母”
          if (this.stopped) return;
          execution?.signal.throwIfAborted();
          await this.graphProgressService.onDocQueued(kbId, docId, chunkCount);

          // 自动重试必须复用失败 job 的显式模型，避免同一文档在重试时悄悄换模型。
          const llmModelId = retryLlmModelId;
          if (!llmModelId) {
            this.logger.warn(`自动重试放弃：无可用抽取模型: kbId=${kbId}, docId=${docId}`);
            this.clearRetryTimer(kbId, docId);
            return;
          }

          const nextPayload: GraphExtractionJobPayloadInput = {
            taskId: generateTaskId(),
            kbId,
            docId,
            llmModelId,
            priority: 2,
            retry: true,
            // 其余参数沿用默认（与 ingestion/backfill 一致）
            maxEntitiesPerChunk: 32,
            maxEdgesPerChunk: 64,
          };

          this.logger.info(
            `图谱抽取自动重试入队: kbId=${kbId}, docId=${docId}, modelId=${llmModelId}`
          );
          if (this.stopped) return;
          await this.queueManager.addGraphExtractionTask(nextPayload, execution);
          this.graphProgressService.onDocProgress(kbId);
        })().finally(() => {
          // timer 触发后清理占位，更新 attempts
          release();
          if (!this.stopped && !execution?.signal.aborted)
            this.graphExtractionRetryState.set(key, { attempts: nextAttempt, timer: null });
        }),
        `图谱抽取重试失败: kbId=${kbId}, docId=${docId}`,
        execution
      );
    }, waitMs);

    if (this.stopped || execution?.signal.aborted) {
      clearTimeout(timer);
      release();
      return;
    }
    this.graphExtractionRetryState.set(key, { attempts: nextAttempt, timer, release });
    execution?.signal.addEventListener('abort', cancelRetry, { once: true });
  }

  /**
   * 判断某个知识库是否启用“图谱构建”（抽取 + 向量化）。
   *
   * 约定：
   * - 默认关闭：只有显式 true 才视为启用；
   * - 关闭后：不再对新文档入队抽取/索引；已存在图谱不受影响。
   */
  private async isGraphIndexingEnabledForKb(kbId: string): Promise<boolean> {
    const kb = await this.metadataRepo.getKnowledgeBaseById(kbId);
    // kb 不存在时，不触发图谱构建（避免误入队造成无谓资源消耗）
    if (!kb) return false;
    return kb.enableGraphIndexing === true;
  }

  /**
   * 删除文档/知识库前：按 payload(kbId/docId) 取消图谱抽取任务
   */
  async cancelGraphExtractionTasksByDoc(kbId: string, docId: string): Promise<number> {
    const tasks = this.queueManager.listGraphExtractionTasks();
    let cancelled = 0;

    for (const t of tasks) {
      const tKbId = readStringField(t.data, 'kbId');
      const tDocId = readStringField(t.data, 'docId');
      if (tKbId !== kbId) continue;
      if (tDocId !== docId) continue;
      const ok = await this.queueManager.cancelGraphExtractionTask(t.id);
      if (ok) cancelled += 1;
    }

    return cancelled;
  }

  /**
   * 删除文档/知识库前：按 payload(kbId/docId) 取消图谱索引任务
   */
  async cancelGraphIndexingTasksByDoc(kbId: string, docId: string): Promise<number> {
    const tasks = this.queueManager.listGraphIndexingTasks();
    let cancelled = 0;

    for (const t of tasks) {
      const tKbId = readStringField(t.data, 'kbId');
      const tDocId = readStringField(t.data, 'docId');
      if (tKbId !== kbId) continue;
      if (tDocId !== docId) continue;
      const ok = await this.queueManager.cancelGraphIndexingTask(t.id);
      if (ok) cancelled += 1;
    }

    return cancelled;
  }

  async cancelGraphExtractionTasksByKb(kbId: string): Promise<number> {
    const tasks = this.queueManager.listGraphExtractionTasks();
    let cancelled = 0;

    for (const t of tasks) {
      const tKbId = readStringField(t.data, 'kbId');
      if (tKbId !== kbId) continue;
      const ok = await this.queueManager.cancelGraphExtractionTask(t.id);
      if (ok) cancelled += 1;
    }

    return cancelled;
  }

  async cancelGraphIndexingTasksByKb(kbId: string): Promise<number> {
    const tasks = this.queueManager.listGraphIndexingTasks();
    let cancelled = 0;

    for (const t of tasks) {
      const tKbId = readStringField(t.data, 'kbId');
      if (tKbId !== kbId) continue;
      const ok = await this.queueManager.cancelGraphIndexingTask(t.id);
      if (ok) cancelled += 1;
    }

    return cancelled;
  }

  refreshKbGraphProgress(kbId: string): void {
    this.graphProgressService.onDocProgress(kbId);
  }
  async getDocumentWorkStatus(kbId: string, docId: string) {
    const [extraction, indexing] = await Promise.all([
      this.graphRepo.getDocStatus(kbId, docId),
      this.graphRepo.getVectorDocStatus(kbId, docId),
    ]);
    return { extraction, indexing };
  }

  /**
   * 当用户关闭“图谱构建”开关时：
   * - 仅取消队列中尚未开始（PENDING）的图谱抽取/索引任务；
   * - 并把这些“尚未开始抽取”的 queued doc_status 从进度聚合中移除，避免进度卡死。
   *
   * 注意：
   * - RUNNING 的任务不在本方法的职责范围内（避免打断正在执行的 worker，保持语义可预测）。
   */
  async cancelPendingGraphTasksByKb(
    kbId: string
  ): Promise<{ cancelledExtraction: number; cancelledIndexing: number }> {
    let cancelledExtraction = 0;
    let cancelledIndexing = 0;

    // 1) 取消尚未开始的抽取任务，并清理 doc_status(queued, done=0)
    const extractionTasks = this.queueManager.listGraphExtractionTasks();
    for (const t of extractionTasks) {
      const tKbId = readStringField(t.data, 'kbId');
      if (tKbId !== kbId) continue;
      if (t.state !== 'pending') continue;

      const docId = readStringField(t.data, 'docId');
      const ok = await this.queueManager.cancelGraphExtractionTask(t.id);
      if (!ok) continue;
      cancelledExtraction += 1;

      if (docId) {
        const status = await this.graphRepo.getDocStatus(kbId, docId);
        // 只清理“尚未开始”的 queued 记录，避免影响已完成/运行中的状态可观测性
        if (status && status.status === 'queued' && status.doneChunks === 0) {
          await this.graphRepo.deleteDocStatusForDocument(kbId, docId);
        }
      }
    }

    // 2) 取消尚未开始的索引任务（向量化）
    const indexingTasks = this.queueManager.listGraphIndexingTasks();
    for (const t of indexingTasks) {
      const tKbId = readStringField(t.data, 'kbId');
      if (tKbId !== kbId) continue;
      if (t.state !== 'pending') continue;

      const ok = await this.queueManager.cancelGraphIndexingTask(t.id);
      if (ok) cancelledIndexing += 1;
    }

    // 3) 触发一次进度刷新（节流）
    this.graphProgressService.onDocProgress(kbId);

    return { cancelledExtraction, cancelledIndexing };
  }

  /** 本次运行的全库回填，由界面操作触发；llmModelId 是该请求带来的界面当前图谱抽取模型。 */
  startBackfill(llmModelId: string | null): void {
    if (this.stopped || this.extractionBackfillStarted) return;
    if (llmModelId) {
      this.extractionBackfillStarted = true;
    } else if (this.indexBackfillStarted) {
      return;
    }
    this.indexBackfillStarted = true;
    this.logger.info(
      llmModelId
        ? `启动回填：扫描历史文档，为未完成图谱的文档入队（modelId=${llmModelId}）`
        : '启动回填：界面没有选择图谱抽取模型，本轮只补图谱向量索引'
    );
    this.enqueueBackfill({ llmModelId });
  }

  /** 打开某个知识库的图谱构建后，为它已有的文档补图谱。 */
  startKnowledgeBaseBackfill(kbId: string, llmModelId: string | null): void {
    if (this.stopped) return;
    this.logger.info(`知识库开启图谱构建，回填已有文档: kbId=${kbId}, modelId=${llmModelId ?? 'none'}`);
    this.enqueueBackfill({ kbId, llmModelId });
  }

  private enqueueBackfill(scope: GraphBackfillScope): void {
    const run = this.backfillChain.then(() => this.runBackfill(scope));
    this.backfillChain = run.catch(() => undefined);
    this.runBackground(run, '图谱回填失败');
  }

  private hasGraphExtractionTaskForDoc(kbId: string, docId: string): boolean {
    const tasks = this.queueManager.listGraphExtractionTasks();
    for (const t of tasks) {
      if (t.state !== 'pending' && t.state !== 'running') continue;
      const tKbId = readStringField(t.data, 'kbId');
      const tDocId = readStringField(t.data, 'docId');
      if (tKbId === kbId && tDocId === docId) return true;
    }
    return false;
  }

  private hasGraphIndexingTaskForDoc(kbId: string, docId: string): boolean {
    const tasks = this.queueManager.listGraphIndexingTasks();
    for (const t of tasks) {
      if (t.state !== 'pending' && t.state !== 'running') continue;
      const tKbId = readStringField(t.data, 'kbId');
      const tDocId = readStringField(t.data, 'docId');
      if (tKbId === kbId && tDocId === docId) return true;
    }
    return false;
  }

  private async resolveEmbeddingModelIdForKb(kbId: string): Promise<string> {
    const provenance = await this.metadataRepo.getKnowledgeBaseEmbeddingProvenance(kbId);
    if (provenance) return provenance;
    throw new Error(`知识库 ${kbId} 缺少 embedding 索引出身，无法构建图谱向量`);
  }

  private async tryEnqueueIndexingAfterGraphExtraction(kbId: string, docId: string, execution?: KnowledgeExecution): Promise<void> {
    execution?.signal.throwIfAborted();
    if (!(await this.isGraphIndexingEnabledForKb(kbId))) {
      this.logger.info(`图谱构建已关闭，跳过图谱索引入队: kbId=${kbId}, docId=${docId}`);
      return;
    }
    if (this.hasGraphIndexingTaskForDoc(kbId, docId)) return;

    // 只有抽取完成的 doc 才允许索引
    const extractionStatus = await this.graphRepo.getDocStatus(kbId, docId);
    if (!extractionStatus || extractionStatus.status !== 'completed') return;

    const embeddingModelId = await this.resolveEmbeddingModelIdForKb(kbId);

    const existingIndex = await this.graphRepo.getVectorDocStatus(kbId, docId);
    if (
      existingIndex &&
      existingIndex.status === 'completed' &&
      existingIndex.embeddingModelId === embeddingModelId
    ) {
      return;
    }

    const payload: GraphIndexingJobPayloadInput = {
      taskId: generateTaskId(),
      kbId,
      docId,
      embeddingModelId,
      priority: 2,
      retry: true,
    };

    this.logger.info(
      `图谱索引入队: kbId=${kbId}, docId=${docId}, embeddingModelId=${embeddingModelId}, ` +
        `collections=[${getGraphNodesCollectionName(kbId)}, ${getGraphEdgesCollectionName(kbId)}]`
    );

    if (this.stopped) return;
    await this.queueManager.addGraphIndexingTask(payload, execution);
  }

  private async tryEnqueueAfterIngestion(taskId: string, execution?: KnowledgeExecution): Promise<void> {
    execution?.signal.throwIfAborted();
    const task = this.queueManager.getTaskById(taskId);
    if (!task) {
      this.logger.warn(
        `摄入完成后入队失败：未找到 ingestion task（可能已被清理）: taskId=${taskId}`
      );
      return;
    }

    const kbId = task.data?.kbId;
    const docId = task.data?.docId;
    if (typeof kbId !== 'string' || kbId.trim().length === 0) return;
    if (typeof docId !== 'string' || docId.trim().length === 0) return;

    if (!(await this.isGraphIndexingEnabledForKb(kbId))) {
      this.logger.info(`图谱构建已关闭，跳过图谱抽取入队: kbId=${kbId}, docId=${docId}`);
      return;
    }

    if (this.hasGraphExtractionTaskForDoc(kbId, docId)) {
      this.logger.info(
        `跳过入队：graphExtraction 队列中已存在该文档任务: kbId=${kbId}, docId=${docId}`
      );
      return;
    }

    const graphExtractionModelSnapshot =
      typeof task.data?.graphExtractionModelId === 'string' &&
      task.data.graphExtractionModelId.trim().length > 0
        ? task.data.graphExtractionModelId.trim()
        : null;
    const llmModelId = graphExtractionModelSnapshot;
    if (!llmModelId) {
      this.logger.warn('跳过图谱抽取：上传时没有选择图谱抽取模型', { kbId, docId });
      return;
    }

    const sot = (await this.sotRepo.get(docId)) as DocumentSoT | null;
    if (!sot) {
      this.logger.warn(
        `跳过入队：SoT 不存在（文档可能未完成摄入/已删除）: kbId=${kbId}, docId=${docId}`
      );
      return;
    }
    const chunkCount = collectExtractableTextBlocks(sot).length;

    const existing = await this.graphRepo.getDocStatus(kbId, docId);
    if (
      existing &&
      existing.status === 'completed' &&
      existing.doneChunks >= existing.chunkCount &&
      existing.chunkCount === chunkCount
    ) {
      return;
    }
    if (existing && (existing.status === 'running' || existing.status === 'queued')) {
      // 若状态显示 running/queued，但队列中不存在对应任务，则视为“僵尸状态”（上次异常退出遗留）
      const inQueue = this.hasGraphExtractionTaskForDoc(kbId, docId);
      if (inQueue) return;

      if (existing.status === 'running') {
        this.logger.warn(
          `检测到僵尸 running 状态，将回收并允许重新入队: kbId=${kbId}, docId=${docId}, doneChunks=${existing.doneChunks}, chunkCount=${existing.chunkCount}`
        );
        try {
          if (this.stopped) return;
          await this.graphRepo.updateDocProgress(kbId, docId, existing.doneChunks, 'failed');
        } catch (e) {
          this.logger.warn(
            `回收僵尸 running 状态失败（将继续尝试入队）: kbId=${kbId}, docId=${docId}`,
            e as Error
          );
        }
      } else {
        // queued 且不在队列：直接允许重新入队（不额外改状态）
        this.logger.warn(`检测到僵尸 queued 状态，将重新入队: kbId=${kbId}, docId=${docId}`);
      }
    }

    if (this.stopped) return;
    execution?.signal.throwIfAborted();
    await this.graphProgressService.onDocQueued(kbId, docId, chunkCount);

    const payload: GraphExtractionJobPayloadInput = {
      taskId: generateTaskId(),
      kbId,
      docId,
      llmModelId,
      priority: 2,
      retry: true,
      maxEntitiesPerChunk: 32,
      maxEdgesPerChunk: 64,
    };

    this.logger.info(
      `图谱抽取入队（from ingestion）: kbId=${kbId}, docId=${docId}, chunkCount=${chunkCount}, modelId=${llmModelId}`
    );
    if (this.stopped) return;
    await this.queueManager.addGraphExtractionTask(payload, execution);
  }

  /**
   * 文档内容在摄入完成后发生增量变化时，重新触发图谱抽取。
   *
   * 典型来源：PDF partial 文档“继续解析失败页”恢复了新 blocks。
   * 该方法保持 graph domain 的队列细节封装，调用方只表达“文档需要重新抽取图谱”。
   */
  enqueueGraphExtractionForDocument(
    kbId: string,
    docId: string,
    llmModelId: string | null
  ): Promise<void> {
    if (this.stopped) return Promise.resolve();
    const operation = this.enqueueGraphExtractionForDocumentInternal(
      kbId,
      docId,
      llmModelId
    ).finally(() => this.pendingOperations.delete(operation));
    this.pendingOperations.add(operation);
    return operation;
  }

  private async enqueueGraphExtractionForDocumentInternal(
    kbId: string,
    docId: string,
    llmModelId: string | null
  ): Promise<void> {
    if (typeof kbId !== 'string' || kbId.trim().length === 0) return;
    if (typeof docId !== 'string' || docId.trim().length === 0) return;

    if (!(await this.isGraphIndexingEnabledForKb(kbId))) {
      this.logger.info(`图谱构建已关闭，跳过图谱抽取入队: kbId=${kbId}, docId=${docId}`);
      return;
    }

    if (this.hasGraphExtractionTaskForDoc(kbId, docId)) {
      this.logger.info(
        `跳过入队：graphExtraction 队列中已存在该文档任务: kbId=${kbId}, docId=${docId}`
      );
      return;
    }

    if (!llmModelId) {
      this.logger.warn('跳过图谱抽取：界面没有选择图谱抽取模型', { kbId, docId });
      return;
    }

    const doc = await this.metadataRepo.getDocumentById(docId);
    if (!doc || doc.kbId !== kbId || doc.status !== DocumentStatus.COMPLETED) {
      this.logger.warn(
        `跳过图谱抽取：文档不存在、归属不匹配或尚未完成: kbId=${kbId}, docId=${docId}`
      );
      return;
    }

    const sot = (await this.sotRepo.get(docId)) as DocumentSoT | null;
    if (!sot) {
      this.logger.warn(`跳过图谱抽取：SoT 不存在: kbId=${kbId}, docId=${docId}`);
      return;
    }

    const chunkCount = collectExtractableTextBlocks(sot).length;
    const existing = await this.graphRepo.getDocStatus(kbId, docId);
    if (
      existing &&
      existing.status === 'completed' &&
      existing.doneChunks >= existing.chunkCount &&
      existing.chunkCount === chunkCount
    ) {
      this.logger.info(
        `跳过入队：图谱抽取已覆盖当前 SoT chunk 数: kbId=${kbId}, docId=${docId}, chunkCount=${chunkCount}`
      );
      return;
    }
    if (existing && (existing.status === 'running' || existing.status === 'queued')) {
      const inQueue = this.hasGraphExtractionTaskForDoc(kbId, docId);
      if (inQueue) return;
      if (existing.status === 'running') {
        if (this.stopped) return;
        await this.graphRepo.updateDocProgress(kbId, docId, existing.doneChunks, 'failed');
      }
    }

    if (this.stopped) return;
    await this.graphProgressService.onDocQueued(kbId, docId, chunkCount);
    const payload: GraphExtractionJobPayloadInput = {
      taskId: generateTaskId(),
      kbId,
      docId,
      llmModelId,
      priority: 2,
      retry: true,
      maxEntitiesPerChunk: 32,
      maxEdgesPerChunk: 64,
    };

    this.logger.info(
      `图谱抽取入队（from document incremental update）: kbId=${kbId}, docId=${docId}, chunkCount=${chunkCount}, modelId=${llmModelId}`
    );
    if (this.stopped) return;
    await this.queueManager.addGraphExtractionTask(payload);
  }

  private async runBackfill(scope: GraphBackfillScope): Promise<void> {
    if (this.stopped) return;
    const { llmModelId } = scope;
    const kbs = scope.kbId
      ? [await this.metadataRepo.getKnowledgeBaseById(scope.kbId)].filter(
          (kb): kb is NonNullable<typeof kb> => kb !== undefined
        )
      : await this.metadataRepo.getAllKnowledgeBases();
    if (kbs.length === 0) {
      this.logger.info('回填结束：当前没有任何知识库');
      return;
    }

    let kbCount = 0;
    let docTotal = 0;
    let docCompleted = 0;
    let sotMissing = 0;
    let alreadyCompleted = 0;
    let alreadyRunningQueued = 0;
    let alreadyInQueue = 0;
    let enqueued = 0;
    let indexEnqueued = 0;
    let indexAlreadyCompleted = 0;
    let indexSkippedOther = 0;
    let skippedOther = 0;
    let extractionSkippedNoModel = 0;

    for (const kb of kbs) {
      const kbId = kb.id;
      kbCount += 1;

      if (kb.enableGraphIndexing !== true) {
        // 默认关闭/或用户关闭：不做抽取回填，也不做索引回填
        this.logger.info(`回填跳过：该知识库已关闭图谱构建: kbId=${kbId}`);
        skippedOther += 1;
        continue;
      }

      // 没有 embedding 出身的知识库还没摄入过内容，没有可补的文档；跳过它，不能让它中断其余知识库的回填。
      const embeddingModelIdForKb = await this.metadataRepo.getKnowledgeBaseEmbeddingProvenance(kbId);
      if (!embeddingModelIdForKb) {
        skippedOther += 1;
        continue;
      }

      const docs = await this.metadataRepo.getDocumentsInKnowledgeBase(kbId);

      // 预读取该 KB 下的索引状态，避免对每个 doc 单独 get
      const indexStatuses = await this.graphRepo.listVectorDocStatusByKb(kbId);
      const indexStatusByDocId = new Map(indexStatuses.map(s => [s.docId, s]));

      for (const doc of docs) {
        docTotal += 1;
        if (doc.status !== DocumentStatus.COMPLETED) {
          skippedOther += 1;
          continue;
        }
        docCompleted += 1;

        if (this.hasGraphExtractionTaskForDoc(kbId, doc.id)) {
          alreadyInQueue += 1;
          continue;
        }

        const sot = (await this.sotRepo.get(doc.id)) as DocumentSoT | null;
        if (!sot) {
          sotMissing += 1;
          continue;
        }

        const chunkCount = collectExtractableTextBlocks(sot).length;
        const existing = await this.graphRepo.getDocStatus(kbId, doc.id);
        if (
          existing &&
          existing.status === 'completed' &&
          existing.doneChunks >= existing.chunkCount &&
          existing.chunkCount === chunkCount
        ) {
          alreadyCompleted += 1;

          // 抽取已完成 -> 尝试补齐“向量索引”
          const idx = indexStatusByDocId.get(doc.id);
          const needIndex =
            !idx || idx.status !== 'completed' || idx.embeddingModelId !== embeddingModelIdForKb;
          if (needIndex && !this.hasGraphIndexingTaskForDoc(kbId, doc.id)) {
            const payload: GraphIndexingJobPayloadInput = {
              taskId: generateTaskId(),
              kbId,
              docId: doc.id,
              embeddingModelId: embeddingModelIdForKb,
              priority: 2,
              retry: true,
            };
            this.logger.info(
              `图谱索引入队（backfill）: kbId=${kbId}, docId=${doc.id}, embeddingModelId=${embeddingModelIdForKb}`
            );
            if (this.stopped) return;
            await this.queueManager.addGraphIndexingTask(payload);
            indexEnqueued += 1;
          } else if (!needIndex) {
            indexAlreadyCompleted += 1;
          } else {
            indexSkippedOther += 1;
          }
          continue;
        }
        if (existing && (existing.status === 'running' || existing.status === 'queued')) {
          const inQueue = this.hasGraphExtractionTaskForDoc(kbId, doc.id);
          if (inQueue) {
            alreadyRunningQueued += 1;
            continue;
          }
        }
        // 抽取未完成的文档要用触发这轮回填的界面模型补；没有模型时保留原状态，等带模型的回填。
        if (!llmModelId) {
          extractionSkippedNoModel += 1;
          continue;
        }
        if (existing && (existing.status === 'running' || existing.status === 'queued')) {
          // 僵尸状态：允许重新入队（running 需要先回收）
          if (existing.status === 'running') {
            this.logger.warn(
              `回填发现僵尸 running 状态，将回收并重新入队: kbId=${kbId}, docId=${doc.id}, doneChunks=${existing.doneChunks}, chunkCount=${existing.chunkCount}`
            );
            try {
              if (this.stopped) return;
              await this.graphRepo.updateDocProgress(kbId, doc.id, existing.doneChunks, 'failed');
            } catch (e) {
              this.logger.warn(
                `回填回收僵尸 running 失败（将继续尝试入队）: kbId=${kbId}, docId=${doc.id}`,
                e as Error
              );
            }
          } else {
            this.logger.warn(`回填发现僵尸 queued 状态，将重新入队: kbId=${kbId}, docId=${doc.id}`);
          }
        }

        if (this.stopped) return;
        await this.graphProgressService.onDocQueued(kbId, doc.id, chunkCount);
        const payload: GraphExtractionJobPayloadInput = {
          taskId: generateTaskId(),
          kbId,
          docId: doc.id,
          llmModelId,
          priority: 2,
          retry: true,
          maxEntitiesPerChunk: 32,
          maxEdgesPerChunk: 64,
        };
        this.logger.info(
          `图谱抽取入队（backfill）: kbId=${kbId}, docId=${doc.id}, chunkCount=${chunkCount}, modelId=${llmModelId}`
        );
        if (this.stopped) return;
        await this.queueManager.addGraphExtractionTask(payload);
        enqueued += 1;
      }

      this.graphProgressService.onDocProgress(kbId);
    }

    this.logger.info('图谱抽取回填完成', {
      kbCount,
      docTotal,
      docCompleted,
      sotMissing,
      alreadyCompleted,
      alreadyRunningQueued,
      alreadyInQueue,
      enqueued,
      indexEnqueued,
      indexAlreadyCompleted,
      indexSkippedOther,
      skippedOther,
      extractionSkippedNoModel,
    });
  }
}
