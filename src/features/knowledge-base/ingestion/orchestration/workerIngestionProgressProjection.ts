/**
 * @file src/features/knowledge-base/ingestion/orchestration/workerIngestionProgressProjection.ts
 *
 * @brief 主进程摄取进度投影工具
 *
 * @description
 * 功能 (What): 将 Worker/状态机产生的前端状态(frontendState)与结果(result)投影到主进程读模型
 * 输入 (Input): 前端状态对象或完成/失败事件数据
 * 输出 (Output): 无
 * 副作用 (Side-effects): 更新内存中的 IngestionProgressStore
 */

import { updateIngestionProgress } from '../store/ingestionProgressStore';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readIngestionStatus(value: unknown): 'pending' | 'processing' | 'completed' | 'failed' | 'duplicate' | undefined {
  return value === 'pending' || value === 'processing' || value === 'completed'
    || value === 'failed' || value === 'duplicate'
    ? value
    : undefined;
}

/**
 * 功能 (What): 投影 Worker 进度到摄取进度读模型
 * 输入 (Input / @param):
 * @param frontendState - Worker/状态机传递的标准化前端状态对象
 * @param ctx - 额外上下文（可选：filename）
 * 输出 (Output): 无
 * 副作用 (Side-effects): 更新内存 IngestionProgressStore
 */
export function syncProgressToIngestionStore(frontendState: unknown, ctx?: { filename?: string }): void {
  if (!isRecord(frontendState)) return;
  const docId = readString(frontendState, 'doc_id');
  if (!docId) return;

  const filename = readString(frontendState, 'filename') ?? ctx?.filename ?? '';
  const status = readIngestionStatus(frontendState.status);
  const message = readString(frontendState, 'message');
  if (!status || !message) {
    throw new Error('[IngestionProgressSync] frontendState 缺少合法 status/message');
  }
  const rawStage = readString(frontendState, 'stage');
  const normalizedStage = (rawStage === 'parsing' || rawStage === 'embedding' || rawStage === 'storing' || rawStage === 'completed') ? rawStage : '';
  const progress = readNumber(frontendState, 'progress');
  const stageProgress = readNumber(frontendState, 'stage_progress');

  updateIngestionProgress(docId, {
    doc_id: docId,
    filename,
    status,
    message,
    error: readString(frontendState, 'error'),
    updated_at: Date.now(),
    progress,
    stage: normalizedStage,
    stage_progress: stageProgress
  });
}

/**
 * 功能 (What): 投影 Worker 完成结果到摄取进度读模型
 * 输入 (Input / @param):
 * @param result - Worker 完成消息中的 result 对象
 * @param ctx - 额外上下文（可选：filename）
 * 输出 (Output): 无
 * 副作用 (Side-effects): 更新内存 IngestionProgressStore
 */
export function syncCompletionToIngestionStore(result: unknown, ctx?: { filename?: string }): void {
  if (!isRecord(result)) return;
  const docId = readString(result, 'docId');
  if (!docId) return;

  const isDuplicate = result.duplicate === true;
  const frontendState = isRecord(result.frontendState) ? result.frontendState : undefined;
  const filename = frontendState ? readString(frontendState, 'filename') ?? ctx?.filename ?? '' : ctx?.filename ?? '';
  const status = isDuplicate ? 'duplicate' : 'completed';
  const message = isDuplicate ? '重复文件' : '已完成';

  updateIngestionProgress(docId, {
    doc_id: docId,
    filename,
    status,
    message,
    error: undefined,
    updated_at: Date.now(),
    progress: 100,
    stage: 'completed',
    stage_progress: 100
  });
}
