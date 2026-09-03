/**
 * @file apps/renderer/domains/conversation/history/orchestration/scheduleSyncConversationToHistory.ts
 * @description
 * “新会话”同步到历史列表的统一工具函数（避免各编排器重复实现）。
 *
 * 设计目标：
 * - 触发时机：durable ack 后尽早调度；首问标题编排会先等待 fallback 写入结束；
 * - 稳定性：后端 metadata 可能略有延迟，因此采用“延迟 + 重试拉 metadata + upsert”；
 * - 非阻塞：不阻塞主流程（AI 请求照常进行）。
 */

import { syncConversationMetadataToHistory } from './syncConversationMetadataToHistory';
import type { WorkspaceScope } from '../../../../shared/stores/workspaceScopeStore';

export interface ScheduleSyncConversationToHistoryOptions {
  /** 首次延迟（ms），给后端写入 conversations 元数据留余量 */
  initialDelayMs?: number;
  /** 最大重试次数 */
  maxAttempts?: number;
  /** 每次重试间隔（ms） */
  retryIntervalMs?: number;
  /** 当前对话所属 scope，用于后端 metadata 暂时缺 project_id 时保持前端归属稳定 */
  scope?: WorkspaceScope;
  /** 历史列表展示用时间锚点，当前以用户发送时间为准 */
  lastEventAtOverride?: number;
  /**
   * 同步成功后的回调（例如设置 selectedConversationId）。
   * 注意：此回调只在 metadata 拉到并 prepend 后触发。
   */
  onSynced?: () => void;
  /** metadata 在限定尝试内仍不可用时触发。 */
  onFailed?: () => void;
}

/**
 * 调度一次“将 conversationId 同步进历史列表”的后台任务。
 *
 * 说明：
 * - 只负责把会话元数据 prepend 到历史列表（让 UI 可见）；
 * - 不负责切换 activeConversation（那属于对话状态域）。
 */
export function scheduleSyncConversationToHistory(
  conversationId: string,
  options?: ScheduleSyncConversationToHistoryOptions
): void {
  const safeConversationId = String(conversationId || '').trim();
  if (!safeConversationId) return;

  const initialDelayMs =
    typeof options?.initialDelayMs === 'number' && Number.isFinite(options.initialDelayMs) && options.initialDelayMs >= 0
      ? options.initialDelayMs
      : 500;
  const maxAttempts =
    typeof options?.maxAttempts === 'number' && Number.isFinite(options.maxAttempts) && options.maxAttempts > 0
      ? Math.floor(options.maxAttempts)
      : 6;
  const retryIntervalMs =
    typeof options?.retryIntervalMs === 'number' && Number.isFinite(options.retryIntervalMs) && options.retryIntervalMs > 0
      ? Math.floor(options.retryIntervalMs)
      : 500;

  // 非阻塞执行：不 await
  syncConversationMetadataToHistory(safeConversationId, {
    initialDelayMs,
    maxAttempts,
    retryIntervalMs,
    scope: options?.scope,
    lastEventAtOverride: options?.lastEventAtOverride,
    onSynced: options?.onSynced,
    onFailed: options?.onFailed,
  });
}
