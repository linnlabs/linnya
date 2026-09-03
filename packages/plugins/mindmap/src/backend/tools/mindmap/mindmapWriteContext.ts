/**
 * @file mindmapWriteContext.ts
 * @description MindMap “写版本”模板：锁内重读 + 锁内执行 +（可选）锁内保存
 *
 * 中文说明（根因级）：
 * - MindMap 写版本工具属于典型的 read → mutate → CAS save；
 * - 如果只把 save 放入写入队列，而读/改在锁外，就会用“过期 baseVersion”去保存，仍然冲突；
 * - 因此必须把“重读最新版本 + 执行变更 + 保存”整体放入同一个临界区。
 *
 * 本模块提供一个高内聚的模板函数，后续所有“写 mindmap_versions”的工具都建议复用，
 * 以避免遗漏锁内重读这类关键语义。
 */

import type { ToolContext } from '@plugin/backend/toolRuntime';
import {
  initMindMapDocContext,
  saveMindMapVersion,
  type MindMapDocContext,
} from './mindmapToolUtils';
import {
  withMindMapWriteLock,
  type MindMapWritePurpose,
  type MindMapWriteQueueMetrics,
} from './mindmapWriteQueue';

// ============================================================================
// 类型定义
// ============================================================================

/**
 * apply 返回值：声明是否发生“需要保存版本”的变更。
 *
 * 中文说明：
 * - 对于某些操作（例如 tag_node）可能是“请求合法但无实际变更”，这种情况不应保存新版本；
 * - 通过 didChange 明确表达这层语义，避免模板内做猜测（禁止防御性修复）。
 */
export interface MindMapVersionWriteApplyResult<T> {
  /** apply 的业务结果（由调用方决定结构） */
  result: T;
  /** 是否发生变更（是否需要 saveMindMapVersion） */
  didChange: boolean;
}

export interface WithMindMapVersionWriteParams<T> {
  /** MindMap 文档 ID（队列 key） */
  documentId: string;
  /** ToolContext（用于 initMindMapDocContext 访问 DB/服务） */
  context: ToolContext;
  /** 写入目的（用于日志/统计） */
  purpose: MindMapWritePurpose;
  /** AbortSignal（排队阶段检查） */
  abortSignal?: AbortSignal;
  /** 排队超时（毫秒） */
  timeoutMs?: number;
  /**
   * 锁内执行的 apply 回调（必须纯粹表达“操作意图”）
   *
   * 中文说明：
   * - 该回调拿到的是“锁内重读的最新 ctx”；不得在锁外缓存 ctx 再传入；
   * - 回调应直接修改 ctx.nodeData（或其子树）；
   * - 回调返回 didChange，用于决定是否保存新版本。
   */
  apply: (ctx: MindMapDocContext) => Promise<MindMapVersionWriteApplyResult<T>>;
}

export interface WithMindMapVersionWriteResult<T> {
  /** apply 的业务结果 */
  result: T;
  /** 本次锁内读取到的 baseVersionNumber */
  baseVersionNumber: number;
  /** 是否写入了新版本 */
  didSave: boolean;
  /** 若 didSave=true，则为保存后的新版本号 */
  versionNumber?: number;
  /** 写入队列指标（排队/锁持有时长） */
  metrics: MindMapWriteQueueMetrics;
  /** 文档名（UI/工具返回常用） */
  documentName: string;
}

// ============================================================================
// 核心模板
// ============================================================================

/**
 * MindMap 写版本模板（锁内重读 + apply + 可选 save）
 *
 * 重要语义：
 * - 同一 documentId 下 FIFO 串行执行（由 withMindMapWriteLock 保证）
 * - 锁内 initMindMapDocContext，确保 baseVersion 是最新
 * - 仅当 apply 返回 didChange=true 时保存新版本
 */
export async function withMindMapVersionWrite<T>(
  params: WithMindMapVersionWriteParams<T>
): Promise<WithMindMapVersionWriteResult<T>> {
  const { documentId, context, purpose, abortSignal, timeoutMs, apply } = params;

  const { result: inner, metrics } = await withMindMapWriteLock({
    documentId,
    purpose,
    abortSignal,
    timeoutMs,
    fn: async () => {
      const initResult = initMindMapDocContext(documentId, context);
      if (!initResult.success) {
        throw new Error(initResult.error);
      }

      const ctx = initResult.ctx;
      const baseVersionNumber = ctx.versionNumber;

      const applyResult = await apply(ctx);
      if (!applyResult || typeof applyResult.didChange !== 'boolean') {
        // 中文说明：这是开发期契约校验（非防御性修复），避免工具误用导致“静默不保存/误保存”。
        throw new Error('withMindMapVersionWrite: apply 必须返回 { result, didChange }，且 didChange 为 boolean');
      }

      if (applyResult.didChange) {
        const save = saveMindMapVersion(ctx);
        return {
          documentName: ctx.documentName,
          baseVersionNumber,
          didSave: true,
          versionNumber: save.versionNumber,
          result: applyResult.result,
        };
      }

      return {
        documentName: ctx.documentName,
        baseVersionNumber,
        didSave: false,
        versionNumber: undefined,
        result: applyResult.result,
      };
    },
  });

  return {
    result: inner.result,
    baseVersionNumber: inner.baseVersionNumber,
    didSave: inner.didSave,
    versionNumber: inner.versionNumber,
    metrics,
    documentName: inner.documentName,
  };
}

