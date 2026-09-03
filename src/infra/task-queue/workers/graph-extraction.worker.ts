/**
 * @file src/task-queue/workers/graph-extraction.worker.ts
 *
 * @brief 软知识图谱抽取 Worker（Milestone 3）
 *
 * @description
 * 功能 (What):
 * - 在独立线程中读取 SoT 文档块（chunk）；
 * - 调用 LLM 抽取实体/关系；
 * - 将结果写入 workspace.sqlite 的 knowledge_graph_* 表；
 * - 更新 knowledge_graph_doc_status（chunk_count/done_chunks/status）。
 *
 * 边界规则（与实现方案一致）：
 * - SoT 不存在：任务失败并退出（不写 doc_status，避免污染“看似开始但其实无数据”的状态）
 * - 文档被删除：若发现 kb_documents 中已不存在，则任务失败并退出
 * - 任务可取消/可暂停：与 WorkerThreadQueue 的 cmd 协议保持一致
 */

import { parentPort, workerData } from 'worker_threads';

import { enableDiagnosticLogForwarding, Logger } from '../../../shared/logger';
import { modelCatalog } from 'src/domains/model-catalog';
import { pathManager } from '../../../shared/utils/pathManager';
import {
  installRuntimePathRoots,
  type RuntimePathRoots,
} from '../../../shared/runtime-paths';
import { getDatabaseService } from '../../../electron-main/services/database';
import { BetterSqliteMetadataRepository } from '../../../features/knowledge-base/infrastructure/sqlite/better-sqlite-metadata.repository';
import { FileSotRepository } from '../../../features/knowledge-base/infrastructure/sotRepository';
import type { DocumentSoT } from '../../../features/knowledge-base/domain/block';
import { BetterSqliteKnowledgeGraphRepository } from '../../../features/knowledge-base/graph/infrastructure/better-sqlite-knowledge-graph.repository';
import { GraphExtractionService } from '../../../features/knowledge-base/graph/application/graphExtractionService';
import type {
  KnowledgeGraphEdgeUpsertInput,
  KnowledgeGraphNodeUpsertInput,
} from '../../../features/knowledge-base/graph/infrastructure/knowledgeGraphRepository';
import { collectExtractableTextBlocks } from '../../../features/knowledge-base/graph/application/extractableBlocks';
import { getKnowledgeGraphExtractionModelPolicy } from 'src/app-hosts/linnya/agent-registry/internals/knowledge_graph_extraction';
import {
  createDefaultHostInferencePort,
  createTextGenerationPort,
} from 'src/app-hosts/linnya/adapters/inference';
import {
  GraphExtractionJobPayloadSchema,
  validateJobPayload,
  type GraphExtractionJobPayload,
} from '../jobs';

if (parentPort) {
  const diagnosticPort = parentPort;
  enableDiagnosticLogForwarding(envelope => diagnosticPort.postMessage(envelope));
}

const logger = new Logger('GraphExtractionWorker');
logger.info('🚀 Worker脚本启动');

// 全局状态标志
let isCancelled = false;
let isPaused = false;

type WorkerMessageType = 'progress' | 'completed' | 'failed';
type WorkerOutboundMessage =
  | { type: 'failed'; timestamp: number; error: string }
  | { type: 'progress'; timestamp: number; frontendState: unknown }
  | { type: 'completed'; timestamp: number; result: unknown };

function sendMessage(type: WorkerMessageType, data: unknown): void {
  if (!parentPort) return;
  const timestamp = Date.now();
  const msg: WorkerOutboundMessage =
    type === 'failed'
      ? { type: 'failed', timestamp, error: typeof data === 'string' ? data : String(data) }
      : type === 'completed'
        ? { type: 'completed', timestamp, result: data }
        : { type: 'progress', timestamp, frontendState: data };
  parentPort.postMessage(msg);
}

function installWorkerRuntimePathRoots(): void {
  const runtimePathRoots = (
    workerData as { readonly runtimePathRoots?: RuntimePathRoots } | undefined
  )?.runtimePathRoots;
  if (!runtimePathRoots) {
    throw new Error('[GraphExtractionWorker] 缺少 owner 传入的 Runtime path roots');
  }
  installRuntimePathRoots(runtimePathRoots);
}

async function initializeWorkerServices(): Promise<void> {
  installWorkerRuntimePathRoots();

  // 初始化模型注册表
  if (modelCatalog.getModels().length === 0) {
    await modelCatalog.initialize();
  }

}

async function processGraphExtractionJob(): Promise<void> {
  // 用于异常兜底写回 doc_status（根因修复：避免 running 僵尸锁）
  let graphRepoForFailure: BetterSqliteKnowledgeGraphRepository | null = null;
  let failureKbId: string | null = null;
  let failureDocId: string | null = null;
  let failureDoneChunks = 0;

  let jobData: GraphExtractionJobPayload;
  try {
    jobData = validateJobPayload(GraphExtractionJobPayloadSchema, workerData);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    sendMessage('failed', `任务参数验证失败: ${msg}`);
    return;
  }

  logger.info(`开始图谱抽取: kbId=${jobData.kbId}, docId=${jobData.docId}, taskId=${jobData.taskId}`);

  if (isCancelled) {
    sendMessage('failed', '任务已取消');
    return;
  }

  try {
    await initializeWorkerServices();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    sendMessage('failed', `Worker环境初始化失败: ${msg}`);
    return;
  }

  // 先读 SoT，确保存在后再写 doc_status（避免污染状态）
  const sotRepository = new FileSotRepository(pathManager.getSourceOfTruthPath());
  const sot = await sotRepository.get(jobData.docId);
  if (!sot) {
    sendMessage('failed', `SoT 不存在，无法进行图谱抽取: docId=${jobData.docId}`);
    return;
  }

  try {
    // Worker 线程内需要独立的 DB 连接，只建连接 + 设 pragma，不重跑迁移/插件 lifecycle（F1-02）
    const databaseService = getDatabaseService();
    databaseService.initializeConnectionOnly();

    const metadataRepository = new BetterSqliteMetadataRepository(databaseService);
    const doc = await metadataRepository.getDocumentById(jobData.docId);
    if (!doc || doc.kbId !== jobData.kbId) {
      sendMessage('failed', `文档不存在或不属于该知识库（可能已被删除）: docId=${jobData.docId}, kbId=${jobData.kbId}`);
      return;
    }

    const graphRepo = new BetterSqliteKnowledgeGraphRepository(databaseService);
    graphRepoForFailure = graphRepo;
    failureKbId = jobData.kbId;
    failureDocId = jobData.docId;
    // Graph worker 拥有批次级重试；TextGenerationPort 只执行一次 Provider attempt。
    const textGeneration = createTextGenerationPort({
      inferencePort: createDefaultHostInferencePort(),
    });
    const extractor = new GraphExtractionService(textGeneration);

    /**
     * 对“可恢复的瞬时错误”做有限重试（网络抖动 + 结构抖动）。
     *
     * 背景（真实线上现象）：
     * - GraphExtractionWorker 偶发出现 `fetch failed`，其 cause 为 `HeadersTimeoutError`；
     * - 也可能出现“模型输出偶发结构不完整”的情况（比如 JSON 少符号、尾部拼接、漏 chunk_id）；
     * - 这类失败通常是短暂网络/对端抖动，直接把整篇 doc 标记 failed 会让 KB 进度看起来“停住”；
     * - 因此在 batch 级别做重试：既不改变图谱语义，也能显著降低误失败率。
     *
     * 约束：
     * - 重试次数有限，避免无休止阻塞队列；
     * - 如果是数据前置条件问题（SoT 缺失/文档被删）在进入 batch 前已拦截，不属于此处重试范围。
     */
    const sleepMs = async (ms: number): Promise<void> => {
      await new Promise<void>((resolve) => setTimeout(resolve, ms));
    };

    const getErrorMessage = (err: unknown): string => {
      if (err instanceof Error) return err.message;
      if (typeof err === 'string') return err;
      return String(err);
    };

    const getErrorName = (err: unknown): string | null => {
      if (err instanceof Error) return err.name;
      if (typeof err === 'object' && err !== null && 'name' in err) {
        const name = (err as { name?: unknown }).name;
        return typeof name === 'string' ? name : null;
      }
      return null;
    };

    const getErrorCause = (err: unknown): unknown => {
      // 兼容：某些 TS target/lib 下 Error.cause 不在类型定义里，因此用结构化访问
      if (typeof err === 'object' && err !== null && 'cause' in err) {
        return (err as { cause?: unknown }).cause;
      }
      return undefined;
    };

    const isRetriableTransientError = (err: unknown): boolean => {
      const message = getErrorMessage(err);
      const name = getErrorName(err);
      const cause = getErrorCause(err);
      const causeName = getErrorName(cause);
      const causeMessage = getErrorMessage(cause);

      // undici/gemini 常见：TypeError: fetch failed + cause=HeadersTimeoutError
      if (message.includes('fetch failed')) return true;
      if (name === 'HeadersTimeoutError') return true;
      if (causeName === 'HeadersTimeoutError') return true;
      if (causeMessage.includes('Headers Timeout')) return true;

      // 兜底：网络错误/超时等关键词（保持严格，避免误把业务错误当可重试）
      if (message.includes('timeout') || message.includes('Timeout')) return true;

      // 结构抖动：JSON / schema / chunk_id 覆盖不全
      if (message.includes('Unexpected non-whitespace character after JSON')) return true;
      if (message.includes('JSON.parse')) return true;
      if (message.includes('ZodError')) return true;
      /**
       * ✅ 根因修复：输出被截断导致 JSON 数组不完整（常见于 fallback 模型达到 token 上限）。
       *
       * 现象（与你日志一致）：
       * - deepseek-chat / 其他模型 finish_reason=length，尾部被截断
       * - extractLikelyJsonArray 无法找到配对的 ']'，抛出该错误
       *
       * 处理策略：
       * - 该类错误本质上是“输出长度约束”问题，属于可恢复错误（通过减小 chunksPerCall 可以恢复）
       */
      if (message.includes('JSON 数组不完整')) return true;
      if (message.includes('无法找到匹配的 "]"')) return true;
      // 某些模型会完全不按 JSON 数组输出（偶发）；仍按“结构抖动”处理，交由重试/降 batchSize 兜底
      if (message.includes('LLM 输出不包含可解析的 JSON 数组')) return true;
      if (message.includes('未覆盖全部 chunk_id')) return true;
      if (message.includes('LLM 输出未覆盖全部 chunk_id')) return true;

      return false;
    };

    /**
     * 判断是否属于“输出被截断/结构不完整”类错误。
     *
     * 说明：
     * - 这类错误仅靠“重试同样的输入”通常无效，因为输入规模不变，仍会触发 token 上限；
     * - 正确修复是降低每次调用包含的 chunk 数（chunksPerCall），让单次输出可控。
     */
    const isTruncationLikeError = (err: unknown): boolean => {
      const message = getErrorMessage(err);
      return (
        message.includes('JSON 数组不完整') ||
        message.includes('无法找到匹配的 "]"') ||
        message.includes('LLM 输出不包含可解析的 JSON 数组')
      );
    };

    const extractFromChunksWithRetry = async (args: {
      llmModelId: string;
      chunks: Array<{
        kbId: string;
        docId: string;
        blockId: string;
        text: string;
      }>;
      limits: { maxEntitiesPerChunk: number; maxEdgesPerChunk: number };
    }): Promise<{ nodes: KnowledgeGraphNodeUpsertInput[]; edges: KnowledgeGraphEdgeUpsertInput[] }> => {
      const policy = getKnowledgeGraphExtractionModelPolicy();
      /**
       * ✅ jobData.retry 是队列层的开关；这里只对图谱抽取生效
       *
       * 策略：
       * - 只使用 job payload 中的模型；
       * - 可恢复错误最多同模型重试 N 次；
       * - 不切换备用模型，避免同一篇文档混用不同抽取模型。
       */
      const maxAttemptsPerModel = jobData.retry ? policy.maxAttemptsPerModelWhenRetryEnabled : 1;
      const baseBackoffMs = 1500;

      let lastError: unknown = null;
      const modelId = args.llmModelId;
      for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
        try {
          return await extractor.extractFromChunks(modelId, args.chunks, args.limits);
        } catch (err) {
          lastError = err;
          /**
           * ✅ 根因修复：输出被截断（finish_reason=length）时，重试“同样的输入”通常无效。
           *
           * - 该错误的可恢复手段是“缩短输出”（降低 chunksPerCall / 降低 limits），而不是同模型原样重试；
           * - 因此这里直接把错误抛给外层，让外层做自适应降参后再发起下一次请求。
           */
          if (isTruncationLikeError(err)) {
            throw err;
          }
          const retriable = isRetriableTransientError(err);
          const message = getErrorMessage(err);

          // 非可恢复错误：不做无意义重试，也不切换模型
          if (!retriable) {
            throw err;
          }

          if (attempt >= maxAttemptsPerModel) {
            logger.warn(
              `[GraphExtractionWorker] 批量抽取失败（可重试）但同模型已达上限: modelId=${modelId}, attempt=${attempt}/${maxAttemptsPerModel}, error=${message}`
            );
            break;
          }

          const backoffMs = Math.min(30_000, baseBackoffMs * Math.pow(2, attempt - 1));
          const jitterMs = Math.floor(Math.random() * 200);
          const waitMs = backoffMs + jitterMs;

          logger.warn(
            `[GraphExtractionWorker] 批量抽取失败（可重试：网络/结构抖动），将同模型重试: modelId=${modelId}, attempt=${attempt}/${maxAttemptsPerModel}, waitMs=${waitMs}, error=${message}`
          );
          await sleepMs(waitMs);
        }
      }

      throw lastError instanceof Error ? lastError : new Error('批量抽取失败：同模型已重试到上限');
    };

    const blocks = collectExtractableTextBlocks(sot as DocumentSoT);
    const chunkCount = blocks.length;
    logger.info(
      `[GraphExtractionWorker] 文本块统计（chunk）：kbId=${jobData.kbId}, docId=${jobData.docId}, chunkCount=${chunkCount}`
    );

    // 互斥：同一 doc 不允许并发两次抽取
    const existing = await graphRepo.getDocStatus(jobData.kbId, jobData.docId);
    if (
      existing &&
      existing.status === 'completed' &&
      existing.doneChunks >= existing.chunkCount &&
      existing.chunkCount === chunkCount
    ) {
      sendMessage('completed', {
        kbId: jobData.kbId,
        docId: jobData.docId,
        chunkCount,
        skipped: 'already_completed',
      });
      return;
    }

    /**
     * 根因修复：失败后断点续跑（只重跑失败/未完成的 chunk）
     *
     * 约定：
     * - doc_status.done_chunks 表示“已成功完成的 chunk 数”（按 blocks 顺序累计）；
     * - 一旦某个 batch 失败，worker 会把 doc_status 标为 failed，并保留当时的 done_chunks；
     * - 下次重新入队/自动重试时，从 done_chunks 对应的 offset 继续跑，避免整篇重跑。
     *
     * 注意：
     * - 该机制依赖 blocks 的顺序稳定（collectExtractableTextBlocks 对同一 SoT 应稳定）；
     * - 若 SoT 发生变化导致 chunkCount 改变，我们将从 0 重新开始（避免错位导致漏抽/重抽）。
     */
    const existingDoneChunks =
      existing && existing.chunkCount === chunkCount && existing.doneChunks > 0 ? existing.doneChunks : 0;

    const acquired = await graphRepo.tryAcquireDocExtractionLock(
      jobData.kbId,
      jobData.docId,
      chunkCount,
      existingDoneChunks
    );
    if (!acquired) {
      // 已有抽取在跑：本次视为“无需再做”，避免无意义重试
      sendMessage('completed', {
        kbId: jobData.kbId,
        docId: jobData.docId,
        chunkCount,
        skipped: 'already_running',
      });
      return;
    }

    if (chunkCount === 0) {
      await graphRepo.updateDocProgress(jobData.kbId, jobData.docId, 0, 'completed');
      sendMessage('completed', { kbId: jobData.kbId, docId: jobData.docId, chunkCount: 0 });
      return;
    }

    let doneChunks = existingDoneChunks;
    // ✅ 重要：chunksPerCall 允许在运行时动态下调（应对 fallback 模型 token 上限导致的截断）
    let chunksPerCall = Math.max(1, jobData.chunksPerCall);
    // ✅ 当 chunksPerCall 已降到 1 仍被截断，则继续降低“抽取上限”缩短输出（否则仍会无限截断）
    let maxEntitiesPerChunk = jobData.maxEntitiesPerChunk;
    let maxEdgesPerChunk = jobData.maxEdgesPerChunk;
    /**
     * 不能使用 `for (offset += chunksPerCall)` 的固定步长，因为我们会在运行时下调 chunksPerCall。
     * 这里改为 while 循环：
     * - 成功：offset += 实际 batchSize
     * - 失败且判定“截断”：仅下调 chunksPerCall，offset 不变，原地重试
     */
    let offset = doneChunks;
    while (offset < blocks.length) {
      if (isCancelled) {
        await graphRepo.updateDocProgress(jobData.kbId, jobData.docId, doneChunks, 'cancelled');
        sendMessage('failed', '任务已取消');
        return;
      }
      if (isPaused) {
        await graphRepo.updateDocProgress(jobData.kbId, jobData.docId, doneChunks, 'cancelled');
        sendMessage('failed', '任务已暂停');
        return;
      }

      /**
       * ✅ 根因修复：当出现“输出截断/JSON 不完整”时，自动降低本次 batchSize 并重试同一 offset。
       *
       * 关键约束：
       * - 不能提前推进 doneChunks，否则会把“未成功抽取的 chunk”计入完成，导致永远不再重跑；
       * - 下调 chunksPerCall 后，本轮 offset 必须保持不变（用 continue 触发下一轮重试）。
       */
      const startedAtMs = Date.now();
      const batch = blocks.slice(offset, offset + chunksPerCall);
      const batchBlockIds = batch.map((b) => b.blockId);
      logger.info(
        `[GraphExtractionWorker] 批量调用 LLM 做图谱抽取: kbId=${jobData.kbId}, docId=${jobData.docId}, batchSize=${batch.length}, blockIds=${batchBlockIds.join(
          ','
        )}, modelId=${jobData.llmModelId}`
      );

      let nodes: KnowledgeGraphNodeUpsertInput[] = [];
      let edges: KnowledgeGraphEdgeUpsertInput[] = [];
      try {
        const extracted = await extractFromChunksWithRetry({
        llmModelId: jobData.llmModelId,
        chunks: batch.map((b) => ({
          kbId: jobData.kbId,
          docId: jobData.docId,
          blockId: b.blockId,
          text: b.text,
        })),
          limits: { maxEntitiesPerChunk, maxEdgesPerChunk },
        });
        nodes = extracted.nodes;
        edges = extracted.edges;
      } catch (e) {
        /**
         * ✅ 根因修复：DeepSeek 等模型 finish_reason=length 时会把 JSON 数组截断，
         * 这类错误必须通过“缩短输出”来恢复：
         * - 优先降低 chunksPerCall
         * - 若 chunksPerCall=1 仍截断，则降低 limits（实体/边上限）
         */
        if (isTruncationLikeError(e)) {
          if (chunksPerCall > 1) {
            const next = Math.max(1, Math.floor(chunksPerCall / 2));
            logger.warn(
              `[GraphExtractionWorker] 检测到输出截断/JSON 不完整，将降低 chunksPerCall 并重试: ` +
                `kbId=${jobData.kbId}, docId=${jobData.docId}, chunksPerCall ${chunksPerCall} -> ${next}, error=${getErrorMessage(e)}`
            );
            chunksPerCall = next;
            continue;
          }

          // batchSize 已经是 1：进一步降低抽取上限，缩短输出
          const nextEntities = Math.max(4, Math.floor(maxEntitiesPerChunk / 2));
          const nextEdges = Math.max(8, Math.floor(maxEdgesPerChunk / 2));
          if (nextEntities === maxEntitiesPerChunk && nextEdges === maxEdgesPerChunk) {
            // 已到下限仍截断：说明单 chunk 仍无法在模型输出限制内完成，交由失败上报
            throw e;
          }
          logger.warn(
            `[GraphExtractionWorker] chunksPerCall=1 仍截断，将降低 limits 并重试: kbId=${jobData.kbId}, docId=${jobData.docId}, ` +
              `maxEntitiesPerChunk ${maxEntitiesPerChunk} -> ${nextEntities}, maxEdgesPerChunk ${maxEdgesPerChunk} -> ${nextEdges}, error=${getErrorMessage(e)}`
          );
          maxEntitiesPerChunk = nextEntities;
          maxEdgesPerChunk = nextEdges;
          continue;
        }
        throw e;
      }

      logger.info(
        `[GraphExtractionWorker] batch 抽取结果: kbId=${jobData.kbId}, docId=${jobData.docId}, batchSize=${batch.length}, nodes=${nodes.length}, edges=${edges.length}, costMs=${
          Date.now() - startedAtMs
        }`
      );

      if (nodes.length > 0) await graphRepo.upsertNodes(nodes);
      if (edges.length > 0) await graphRepo.upsertEdges(edges);

      doneChunks += batch.length;
      failureDoneChunks = doneChunks;
      await graphRepo.updateDocProgress(jobData.kbId, jobData.docId, doneChunks, 'running');

      const progress = Math.round((doneChunks / chunkCount) * 100);
      logger.info(
        `[GraphExtractionWorker] 进度推进: kbId=${jobData.kbId}, docId=${jobData.docId}, doneChunks=${doneChunks}/${chunkCount}, progress=${progress}%`
      );
      sendMessage('progress', {
        progress,
        stage: 'graph_extraction',
        kbId: jobData.kbId,
        docId: jobData.docId,
        doneChunks,
        chunkCount,
        currentBlockId: batch[batch.length - 1]?.blockId ?? null,
        currentBatchBlockIds: batchBlockIds,
        chunksPerCall,
      });

      // ✅ 只有在该 batch 真正成功并写入后，才推进 offset
      offset += batch.length;
    }

    await graphRepo.updateDocProgress(jobData.kbId, jobData.docId, chunkCount, 'completed');
    sendMessage('completed', { kbId: jobData.kbId, docId: jobData.docId, chunkCount });
    try {
      process.exit(0);
    } catch {
      // ignore
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('图谱抽取任务失败', error);
    // 根因修复：Worker 异常时必须将 doc_status 从 running 回收为 failed，
    // 否则下次启动回填会看到 running/queued 而误判“已经在跑”，从而永远不再入队。
    try {
      if (graphRepoForFailure && failureKbId && failureDocId) {
        await graphRepoForFailure.updateDocProgress(failureKbId, failureDocId, failureDoneChunks, 'failed');
      }
    } catch (e) {
      logger.warn('异常时写回 doc_status=failed 失败（将仅上报 failed 消息）', e as Error);
    }
    sendMessage('failed', `图谱抽取失败: ${msg}`);
  }
}

// 监听主线程消息（任务控制）
if (parentPort) {
  parentPort.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const cmd = (message as { cmd?: unknown }).cmd;
    if (cmd === 'cancel') {
      logger.info('收到取消信号');
      isCancelled = true;
    } else if (cmd === 'pause') {
      logger.info('收到暂停信号');
      isPaused = true;
    }
  });
}

processGraphExtractionJob();

export default processGraphExtractionJob;
