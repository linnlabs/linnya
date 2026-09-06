/**
 * @file mindmapWriteQueue.ts
 * @description MindMap per-document 写入队列（FIFO 串行化）
 *
 * 中文说明（根因级设计）：
 * - MindMap 写图工具使用整文档版本链 CAS；
 * - 并行子 agent 写同一文档会产生"版本冲突 → throw"的结构性问题（哪怕写不同节点）；
 * - 本模块提供 per-document 的写入串行化原语，让并行写版本变为"排队写"，避免 CAS 冲突。
 *
 * 核心语义：
 * - 同一 documentId 下严格 FIFO（先到先写）
 * - 不同 documentId 可完全并行
 * - 支持 AbortSignal：排队阶段 abort → 立刻拒绝进入临界区
 * - 支持可选超时（timeoutMs）
 * - 输出结构化日志（queue_depth / queued_ms / lock_held_ms）
 *
 * 假设：单后端进程（Electron main）；多进程场景需升级为 DB 层协调。
 *
 * @see packages/plugins/mindmap/src/backend/tools/mindmap/README.md
 */

import { Logger } from '@plugin/backend/workspaceRuntime';

const logger = new Logger('MindMapWriteQueue');

// ============================================================================
// 类型定义
// ============================================================================

/** 写入目的（用于日志/统计） */
export type MindMapWritePurpose = 'create_node' | 'other';

/** withMindMapWriteLock 的参数 */
export interface MindMapWriteLockParams<T> {
  /** 文档 ID（锁的 key） */
  documentId: string;
  /** 写入目的（日志/统计） */
  purpose: MindMapWritePurpose;
  /** AbortSignal（排队阶段检查，用户终止应尽快退出） */
  abortSignal?: AbortSignal;
  /** 排队超时（毫秒）；不传则不超时 */
  timeoutMs?: number;
  /**
   * 临界区回调
   *
   * 中文说明：
   * - 进入回调时，本 documentId 下没有其他写入在执行
   * - 回调内应执行"重读最新版本 → apply 变更 → saveMindMapVersion"
   * - 回调抛错会透传给调用方（不静默吞掉）
   */
  fn: () => Promise<T>;
}

/** 写入队列的可观测指标（附加到工具返回中，供排查使用） */
export interface MindMapWriteQueueMetrics {
  /** 进入队列时的排队深度 */
  queueDepthOnEnqueue: number;
  /** 排队等待时长（毫秒） */
  queuedMs: number;
  /** 临界区执行时长（毫秒） */
  lockHeldMs: number;
}

// ============================================================================
// 队列实现
// ============================================================================

/**
 * per-document 串行化队列（Promise Chain 模式）
 *
 * 中文说明：
 * - 每个 documentId 对应一条 Promise Chain；
 * - 新的写入请求 .then() 到链尾部，天然保证 FIFO；
 * - 链空闲时自动回收（避免 Map 无限增长）。
 */
class MindMapWriteQueueImpl {
  /**
   * documentId → { chain, depth }
   *
   * chain：当前 Promise Chain 的尾部
   * depth：当前排队深度（含正在执行的 1 个）
   */
  private readonly chains = new Map<string, { chain: Promise<void>; depth: number }>();

  /**
   * 获取当前排队深度（仅用于日志/测试）
   */
  getQueueDepth(documentId: string): number {
    return this.chains.get(documentId)?.depth ?? 0;
  }

  /**
   * 以串行化方式执行写入回调
   *
   * 中文说明：
   * - 同一 documentId 下，多个并发调用会自动排队（FIFO）
   * - 回调执行前检查 AbortSignal 和超时
   * - 回调执行完毕（成功或失败）后释放锁，让下一个排队者进入
   */
  async enqueue<T>(params: MindMapWriteLockParams<T>): Promise<{ result: T; metrics: MindMapWriteQueueMetrics }> {
    const { documentId, purpose, abortSignal, timeoutMs, fn } = params;

    // 排队前检查：如果已经 abort，直接拒绝
    if (abortSignal?.aborted) {
      const err = new Error('MindMapWriteQueue: 排队前已被用户终止');
      err.name = 'AbortError';
      throw err;
    }

    // 获取或创建链
    const entry = this.chains.get(documentId) ?? { chain: Promise.resolve(), depth: 0 };
    const queueDepthOnEnqueue = entry.depth;
    entry.depth += 1;
    this.chains.set(documentId, entry);

    const enqueueTime = Date.now();

    logger.info('[MindMapWriteQueue] 加入写入队列', {
      documentId,
      purpose,
      queueDepthOnEnqueue,
      currentDepth: entry.depth,
    });

    // 构建新的 Promise，挂到链尾
    const taskPromise = new Promise<{ result: T; metrics: MindMapWriteQueueMetrics }>((resolve, reject) => {
      entry.chain = entry.chain.then(async () => {
        const lockAcquireTime = Date.now();
        const queuedMs = lockAcquireTime - enqueueTime;

        // 进入临界区前检查 AbortSignal
        if (abortSignal?.aborted) {
          const err = new Error(`MindMapWriteQueue: 排队 ${queuedMs}ms 后被用户终止（purpose=${purpose}）`);
          err.name = 'AbortError';
          reject(err);
          return;
        }

        // 进入临界区前检查超时
        if (typeof timeoutMs === 'number' && queuedMs > timeoutMs) {
          const err = new Error(
            `MindMapWriteQueue: 排队超时（queued=${queuedMs}ms, limit=${timeoutMs}ms, purpose=${purpose}, documentId=${documentId}）`
          );
          err.name = 'TimeoutError';
          reject(err);
          return;
        }

        logger.info('[MindMapWriteQueue] 进入临界区', {
          documentId,
          purpose,
          queuedMs,
        });

        // 执行临界区回调
        const lockStartTime = Date.now();
        try {
          const result = await fn();
          const lockHeldMs = Date.now() - lockStartTime;

          const metrics: MindMapWriteQueueMetrics = {
            queueDepthOnEnqueue,
            queuedMs,
            lockHeldMs,
          };

          logger.info('[MindMapWriteQueue] 临界区执行完成', {
            documentId,
            purpose,
            queuedMs,
            lockHeldMs,
          });

          resolve({ result, metrics });
        } catch (err) {
          const lockHeldMs = Date.now() - lockStartTime;

          logger.warn('[MindMapWriteQueue] 临界区执行失败', {
            documentId,
            purpose,
            queuedMs,
            lockHeldMs,
            error: err instanceof Error ? err.message : String(err),
          });

          reject(err);
        }
      });
    });

    // 无论成功/失败，都要更新 depth 并清理空闲链
    // 中文说明：
    // - .finally() 返回新 Promise；若 taskPromise 被拒绝，新 Promise 也会拒绝
    // - 必须 .catch(() => {}) 消化这个"影子拒绝"，否则 Node 会报 unhandled rejection
    // - 调用方通过 taskPromise 本身处理拒绝，这里只做资源清理
    taskPromise
      .finally(() => {
        const current = this.chains.get(documentId);
        if (current) {
          current.depth -= 1;
          if (current.depth <= 0) {
            this.chains.delete(documentId);
          }
        }
      })
      .catch(() => {
        // 静默：拒绝已由调用方通过 taskPromise 处理，这里仅消化 .finally() 传播的影子拒绝
      });

    return taskPromise;
  }
}

// ============================================================================
// 单例导出
// ============================================================================

/**
 * 全局写入队列实例（单后端进程内共享）
 *
 * 中文说明：
 * - 所有 MindMap 写图工具共用同一个队列实例
 * - 如果后续有多进程需求，替换此实例为 DB 层协调即可
 */
const mindmapWriteQueue = new MindMapWriteQueueImpl();

/**
 * 以 per-document FIFO 方式执行 MindMap 写入操作
 *
 * @example
 * ```ts
 * const { result, metrics } = await withMindMapWriteLock({
 *   documentId,
 *   purpose: 'create_node',
 *   abortSignal: context.abortSignal,
 *   fn: async () => {
 *     const ctx = initMindMapDocContext(documentId, context);
 *     // ... apply changes ...
 *     saveMindMapVersion(ctx);
 *     return myResult;
 *   },
 * });
 * ```
 */
export async function withMindMapWriteLock<T>(
  params: MindMapWriteLockParams<T>
): Promise<{ result: T; metrics: MindMapWriteQueueMetrics }> {
  return mindmapWriteQueue.enqueue(params);
}

/**
 * 获取指定文档的当前排队深度（仅用于日志/测试）
 */
export function getMindMapWriteQueueDepth(documentId: string): number {
  return mindmapWriteQueue.getQueueDepth(documentId);
}
