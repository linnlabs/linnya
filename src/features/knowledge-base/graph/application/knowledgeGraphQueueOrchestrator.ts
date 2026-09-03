/**
 * @file src/features/knowledge-base/graph/application/knowledgeGraphQueueOrchestrator.ts
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

import { Logger } from 'src/shared/logger';
import { modelCatalog } from 'src/domains/model-catalog';
import { generateTaskId } from 'src/shared/utils/idUtils';
import { pathManager } from 'src/shared/utils/pathManager';
import { FileSotRepository } from '../../infrastructure/sotRepository';
import { BetterSqliteMetadataRepository } from '../../infrastructure/sqlite/better-sqlite-metadata.repository';
import { DocumentStatus } from '../../domain/document';
import type { DocumentSoT } from '../../domain/block';
import { collectExtractableTextBlocks } from './extractableBlocks';
import { BetterSqliteKnowledgeGraphRepository } from '../infrastructure/better-sqlite-knowledge-graph.repository';
import { GraphProgressService, type KbGraphProgressPayload } from './graphProgressService';
import type { GraphExtractionJobPayloadInput, GraphIndexingJobPayloadInput } from 'src/infra/task-queue/jobs';
import type { QueueManager } from 'src/infra/task-queue/queues';
import type { DatabaseService } from 'src/electron-main/services/database';
import { getGraphEdgesCollectionName, getGraphNodesCollectionName } from '../infrastructure/qdrantCollections';
import { WorkerJobState } from 'src/infra/task-queue/WorkerThreadQueue';
import {
  getKnowledgeGraphExtractionModelPolicy,
  resolveKnowledgeGraphExtractionModelId,
} from 'src/app-hosts/linnya/agent-registry/internals/knowledge_graph_extraction';

type MaybeKbIdCarrier = { kbId?: unknown } | null;

function readStringField(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function resolveGraphExtractionModelId(): string | null {
  // ✅ 单一来源：internals/knowledge_graph_extraction/index.ts
  return resolveKnowledgeGraphExtractionModelId({ modelCatalog });
}

export class KnowledgeGraphQueueOrchestrator {
  private readonly logger = new Logger('KnowledgeGraphQueueOrchestrator');
  private readonly queueManager: QueueManager;
  private readonly metadataRepo: BetterSqliteMetadataRepository;
  private readonly graphRepo: BetterSqliteKnowledgeGraphRepository;
  private readonly sotRepo: FileSotRepository;
  private readonly graphProgressService: GraphProgressService;
  private started = false;
  private backfillStarted = false;

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
    { attempts: number; timer: ReturnType<typeof setTimeout> | null }
  >();

  constructor(deps: {
    queueManager: QueueManager;
    databaseService: DatabaseService;
    publishGraphProgress(payload: KbGraphProgressPayload): void;
  }) {
    this.queueManager = deps.queueManager;
    this.metadataRepo = new BetterSqliteMetadataRepository(deps.databaseService);
    this.graphRepo = new BetterSqliteKnowledgeGraphRepository(deps.databaseService);
    this.sotRepo = new FileSotRepository(pathManager.getSourceOfTruthPath());
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
    this.queueManager.on('ingestion:taskCompleted', ({ taskId }) => {
      this.logger.info(`收到 ingestion:taskCompleted，尝试触发图谱抽取入队: ingestionTaskId=${taskId}`);
      void this.tryEnqueueAfterIngestion(taskId).catch((e) => {
        this.logger.warn('摄入完成后图谱抽取入队失败（不会影响摄入完成）', e as Error);
      });
    });

    // 2) graphExtraction 进度/完成触发 KB 级进度聚合
    this.queueManager.on('graphExtraction:taskProgress', ({ data }) => {
      const kbId = readStringField(data as MaybeKbIdCarrier, 'kbId');
      if (kbId) this.graphProgressService.onDocProgress(kbId);
    });
    this.queueManager.on('graphExtraction:taskCompleted', ({ result }) => {
      const kbId = readStringField(result as MaybeKbIdCarrier, 'kbId');
      const docId = readStringField(result as MaybeKbIdCarrier, 'docId');
      if (kbId) this.graphProgressService.onDocProgress(kbId);

      // 抽取完成后：尝试触发“图谱向量索引”（不阻塞抽取完成）
      if (kbId && docId) {
        void this.tryEnqueueIndexingAfterGraphExtraction(kbId, docId).catch((e) => {
          this.logger.warn(`抽取完成后图谱索引入队失败（不会影响抽取完成）: kbId=${kbId}, docId=${docId}`, e as Error);
        });
      }
    });

    this.queueManager.on('graphExtraction:taskFailed', ({ taskId, error }) => {
      this.logger.warn(`graphExtraction:taskFailed: taskId=${taskId}${error ? `, error=${error}` : ''}`);
      void this.tryAutoRetryGraphExtraction(taskId, error).catch((e) => {
        this.logger.warn(`graphExtraction 自动重试调度失败（将等待 backfill 兜底）: taskId=${taskId}`, e as Error);
      });
    });

    // 2.5) graphIndexing 进度/完成仅用于观测（后续可接入 UI）
    this.queueManager.on('graphIndexing:taskProgress', ({ data }) => {
      const kbId = readStringField(data as MaybeKbIdCarrier, 'kbId');
      const docId = readStringField(data as MaybeKbIdCarrier, 'docId');
      if (kbId && docId) {
        this.logger.info(`graphIndexing:taskProgress: kbId=${kbId}, docId=${docId}`);
        // ✅ 端到端进度：索引阶段也要触发 KB 聚合刷新，否则 UI 会在“写向量”阶段停住
        this.graphProgressService.onDocProgress(kbId);
      }
    });
    this.queueManager.on('graphIndexing:taskCompleted', ({ result }) => {
      const kbId = readStringField(result as MaybeKbIdCarrier, 'kbId');
      const docId = readStringField(result as MaybeKbIdCarrier, 'docId');
      if (kbId && docId) {
        this.logger.info(`graphIndexing:taskCompleted: kbId=${kbId}, docId=${docId}`);
        this.graphProgressService.onDocProgress(kbId);
      }
    });
    this.queueManager.on('graphIndexing:taskFailed', ({ taskId, error }) => {
      this.logger.warn(`graphIndexing:taskFailed: taskId=${taskId}${error ? `, error=${error}` : ''}`);
      // 失败同样触发刷新：确保 KB 进度不会错误地显示为 100%
      const payload = this.findGraphIndexingTaskPayload(taskId);
      const kbId = readStringField(payload as MaybeKbIdCarrier, 'kbId');
      if (kbId) this.graphProgressService.onDocProgress(kbId);
    });

    // 3) 启动回填：打开 App 时补齐历史文档（不阻塞启动）
    this.startBackfill();

    this.logger.info('✅ 已启动图谱队列编排器（自动入队 + 回填 + 进度推送）');
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
    const found = tasks.find((t) => t.id === taskId);
    if (!found) return null;
    return found.data ?? null;
  }

  private findGraphIndexingTaskPayload(taskId: string): GraphIndexingJobPayloadInput | null {
    const tasks = this.queueManager.listGraphIndexingTasks();
    const found = tasks.find((t) => t.id === taskId);
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
  private async tryAutoRetryGraphExtraction(taskId: string, error?: string): Promise<void> {
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
    const maxAttempts = getKnowledgeGraphExtractionModelPolicy().maxDocAutoRetryAttempts;
    if (nextAttempt > maxAttempts) {
      this.logger.warn(`自动重试次数已达上限，将不再重试: kbId=${kbId}, docId=${docId}, maxAttempts=${maxAttempts}`);
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

    const timer = setTimeout(() => {
      void (async () => {
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
          this.logger.warn(`自动重试放弃：SoT 不存在（可能已被删除）: kbId=${kbId}, docId=${docId}`);
          this.clearRetryTimer(kbId, docId);
          return;
        }
        const chunkCount = collectExtractableTextBlocks(sot).length;

        // 入队前先写 queued，确保进度聚合能“看到分母”
        await this.graphProgressService.onDocQueued(kbId, docId, chunkCount);

        // 自动重试必须复用失败 job 的显式模型，避免同一文档在重试时悄悄换模型。
        const llmModelId = retryLlmModelId ?? resolveGraphExtractionModelId();
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

        this.logger.info(`图谱抽取自动重试入队: kbId=${kbId}, docId=${docId}, modelId=${llmModelId}`);
        await this.queueManager.addGraphExtractionTask(nextPayload);
        this.graphProgressService.onDocProgress(kbId);
      })().finally(() => {
        // timer 触发后清理占位，更新 attempts
        const state = this.graphExtractionRetryState.get(key) ?? { attempts: 0, timer: null };
        this.graphExtractionRetryState.set(key, { attempts: nextAttempt, timer: null });
      });
    }, waitMs);

    this.graphExtractionRetryState.set(key, { attempts: nextAttempt, timer });
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

  /**
   * 当用户关闭“图谱构建”开关时：
   * - 仅取消队列中尚未开始（PENDING）的图谱抽取/索引任务；
   * - 并把这些“尚未开始抽取”的 queued doc_status 从进度聚合中移除，避免进度卡死。
   *
   * 注意：
   * - RUNNING 的任务不在本方法的职责范围内（避免打断正在执行的 worker，保持语义可预测）。
   */
  async cancelPendingGraphTasksByKb(kbId: string): Promise<{ cancelledExtraction: number; cancelledIndexing: number }> {
    let cancelledExtraction = 0;
    let cancelledIndexing = 0;

    // 1) 取消尚未开始的抽取任务，并清理 doc_status(queued, done=0)
    const extractionTasks = this.queueManager.listGraphExtractionTasks();
    for (const t of extractionTasks) {
      const tKbId = readStringField(t.data, 'kbId');
      if (tKbId !== kbId) continue;
      if (t.state !== WorkerJobState.PENDING) continue;

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
      if (t.state !== WorkerJobState.PENDING) continue;

      const ok = await this.queueManager.cancelGraphIndexingTask(t.id);
      if (ok) cancelledIndexing += 1;
    }

    // 3) 触发一次进度刷新（节流）
    this.graphProgressService.onDocProgress(kbId);

    return { cancelledExtraction, cancelledIndexing };
  }

  private startBackfill(): void {
    if (this.backfillStarted) return;
    this.backfillStarted = true;
    this.logger.info('启动回填：将扫描历史文档并为未完成图谱抽取的文档入队（异步，不阻塞启动）');
    void this.runBackfill().catch((e) => {
      this.logger.warn('图谱抽取回填失败（不会影响核心功能）', e as Error);
    });
  }

  private hasGraphExtractionTaskForDoc(kbId: string, docId: string): boolean {
    const tasks = this.queueManager.listGraphExtractionTasks();
    for (const t of tasks) {
      const tKbId = readStringField(t.data, 'kbId');
      const tDocId = readStringField(t.data, 'docId');
      if (tKbId === kbId && tDocId === docId) return true;
    }
    return false;
  }

  private hasGraphIndexingTaskForDoc(kbId: string, docId: string): boolean {
    const tasks = this.queueManager.listGraphIndexingTasks();
    for (const t of tasks) {
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

  private async tryEnqueueIndexingAfterGraphExtraction(kbId: string, docId: string): Promise<void> {
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

    await this.queueManager.addGraphIndexingTask(payload);
  }

  private async tryEnqueueAfterIngestion(taskId: string): Promise<void> {
    const task = this.queueManager.getTaskById(taskId);
    if (!task) {
      this.logger.warn(`摄入完成后入队失败：未找到 ingestion task（可能已被清理）: taskId=${taskId}`);
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
      this.logger.info(`跳过入队：graphExtraction 队列中已存在该文档任务: kbId=${kbId}, docId=${docId}`);
      return;
    }

    const graphExtractionModelSnapshot = typeof task.data?.graphExtractionModelId === 'string'
      && task.data.graphExtractionModelId.trim().length > 0
      ? task.data.graphExtractionModelId.trim()
      : null;
    const llmModelId = graphExtractionModelSnapshot ?? resolveGraphExtractionModelId();
    if (!llmModelId) {
      this.logger.warn('跳过图谱抽取：未找到可用的聊天模型', { kbId, docId });
      return;
    }

    const sot = (await this.sotRepo.get(docId)) as DocumentSoT | null;
    if (!sot) {
      this.logger.warn(`跳过入队：SoT 不存在（文档可能未完成摄入/已删除）: kbId=${kbId}, docId=${docId}`);
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
          await this.graphRepo.updateDocProgress(kbId, docId, existing.doneChunks, 'failed');
        } catch (e) {
          this.logger.warn(`回收僵尸 running 状态失败（将继续尝试入队）: kbId=${kbId}, docId=${docId}`, e as Error);
        }
      } else {
        // queued 且不在队列：直接允许重新入队（不额外改状态）
        this.logger.warn(`检测到僵尸 queued 状态，将重新入队: kbId=${kbId}, docId=${docId}`);
      }
    }

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
    await this.queueManager.addGraphExtractionTask(payload);
  }

  /**
   * 文档内容在摄入完成后发生增量变化时，重新触发图谱抽取。
   *
   * 典型来源：PDF partial 文档“继续解析失败页”恢复了新 blocks。
   * 该方法保持 graph domain 的队列细节封装，调用方只表达“文档需要重新抽取图谱”。
   */
  async enqueueGraphExtractionForDocument(kbId: string, docId: string): Promise<void> {
    if (typeof kbId !== 'string' || kbId.trim().length === 0) return;
    if (typeof docId !== 'string' || docId.trim().length === 0) return;

    if (!(await this.isGraphIndexingEnabledForKb(kbId))) {
      this.logger.info(`图谱构建已关闭，跳过图谱抽取入队: kbId=${kbId}, docId=${docId}`);
      return;
    }

    if (this.hasGraphExtractionTaskForDoc(kbId, docId)) {
      this.logger.info(`跳过入队：graphExtraction 队列中已存在该文档任务: kbId=${kbId}, docId=${docId}`);
      return;
    }

    const llmModelId = resolveGraphExtractionModelId();
    if (!llmModelId) {
      this.logger.warn('跳过图谱抽取：未找到可用的聊天模型', { kbId, docId });
      return;
    }

    const doc = await this.metadataRepo.getDocumentById(docId);
    if (!doc || doc.kbId !== kbId || doc.status !== DocumentStatus.COMPLETED) {
      this.logger.warn(`跳过图谱抽取：文档不存在、归属不匹配或尚未完成: kbId=${kbId}, docId=${docId}`);
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
      this.logger.info(`跳过入队：图谱抽取已覆盖当前 SoT chunk 数: kbId=${kbId}, docId=${docId}, chunkCount=${chunkCount}`);
      return;
    }
    if (existing && (existing.status === 'running' || existing.status === 'queued')) {
      const inQueue = this.hasGraphExtractionTaskForDoc(kbId, docId);
      if (inQueue) return;
      if (existing.status === 'running') {
        await this.graphRepo.updateDocProgress(kbId, docId, existing.doneChunks, 'failed');
      }
    }

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
    await this.queueManager.addGraphExtractionTask(payload);
  }

  private async runBackfill(): Promise<void> {
    const kbs = await this.metadataRepo.getAllKnowledgeBases();
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

    for (const kb of kbs) {
      const kbId = kb.id;
      kbCount += 1;

      if (kb.enableGraphIndexing !== true) {
        // 默认关闭/或用户关闭：不做抽取回填，也不做索引回填
        this.logger.info(`回填跳过：该知识库已关闭图谱构建: kbId=${kbId}`);
        skippedOther += 1;
        continue;
      }

      const llmModelId = resolveGraphExtractionModelId();
      if (!llmModelId) {
        skippedOther += 1;
        continue;
      }

      const docs = await this.metadataRepo.getDocumentsInKnowledgeBase(kbId);

      // 预读取该 KB 下的索引状态，避免对每个 doc 单独 get
      const indexStatuses = await this.graphRepo.listVectorDocStatusByKb(kbId);
      const indexStatusByDocId = new Map(indexStatuses.map((s) => [s.docId, s]));
      const embeddingModelIdForKb = await this.resolveEmbeddingModelIdForKb(kbId);

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
            !idx ||
            idx.status !== 'completed' ||
            idx.embeddingModelId !== embeddingModelIdForKb;
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
          // 僵尸状态：允许重新入队（running 需要先回收）
          if (existing.status === 'running') {
            this.logger.warn(
              `回填发现僵尸 running 状态，将回收并重新入队: kbId=${kbId}, docId=${doc.id}, doneChunks=${existing.doneChunks}, chunkCount=${existing.chunkCount}`
            );
            try {
              await this.graphRepo.updateDocProgress(kbId, doc.id, existing.doneChunks, 'failed');
            } catch (e) {
              this.logger.warn(`回填回收僵尸 running 失败（将继续尝试入队）: kbId=${kbId}, docId=${doc.id}`, e as Error);
            }
          } else {
            this.logger.warn(`回填发现僵尸 queued 状态，将重新入队: kbId=${kbId}, docId=${doc.id}`);
          }
        }

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
    });
  }
}
