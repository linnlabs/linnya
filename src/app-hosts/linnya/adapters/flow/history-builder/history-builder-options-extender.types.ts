/**
 * @file history-builder-options-extender.types.ts
 * @description HistoryBuilder 的“请求选项扩展点”类型定义
 *
 * 目标：
 * - 让 HistoryBuilder 保持“纯翻译器”职责：只构建通用最小请求
 * - 业务特性（如 Review/...）通过注册方式注入自己的 options → request 扩展字段
 *
 * 注意：
 * - 这里扩展的是 AgentInvokeRequest（传给 AgentRunner / ContextManager 的请求）
 * - 不要在 HistoryBuilder 主体里持续堆叠业务字段
 */

import type { ConversationNextRequest } from '@app/schemas';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';

export interface HistoryBuilderOptionsExtenderContext {
  /**
   * 本次请求的 promptKey（HistoryBuilder 已做 resolved）
   */
  resolvedPromptKey: string;
  /**
   * 原始 options（来自 ConversationNextRequest.options）
   */
  options: ConversationNextRequest['options'] | undefined;
  /**
   * 用户输入事件的 metadata（如果存在）
   */
  lastUserMetadata: Record<string, unknown> | undefined;
}

/**
 * HistoryBuilder 的 options 扩展器：
 * - 只负责从 options/metadata 中“提取字段并注入 AgentInvokeRequest”
 * - 不做数据库访问、不做业务编排（那是 Enricher 的职责）
 */
export interface HistoryBuilderOptionsExtender {
  readonly name: string;

  /**
   * 是否适用于本次请求（通常按 promptKey 判断）
   */
  isApplicable(ctx: HistoryBuilderOptionsExtenderContext): boolean;

  /**
   * 返回要合并到 AgentInvokeRequest 的增量字段
   */
  extend(ctx: HistoryBuilderOptionsExtenderContext): Partial<AgentInvokeRequest>;
}
