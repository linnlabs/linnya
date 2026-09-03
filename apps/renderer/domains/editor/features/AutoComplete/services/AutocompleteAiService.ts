/**
 * @file AutocompleteAiService.ts
 * @description AI 请求服务
 *
 * 职责：
 * - 收集上下文
 * - 调用 AI 服务
 * - 处理响应
 */

import type { Editor } from '@tiptap/vue-3';
import { getAutocompleteStructuredContext } from '../config/contextConfig';
import { generateText } from '../../../../../shared/services/aiService/unifiedApiService';
import { AUTOCOMPLETE_PROMPT_KEY } from '@app/schemas';
import type { RejectionForApi } from '../types';
import type { IntentPrediction } from './IntentPredictor';

interface AutocompleteApiRequest {
  prompt: string;
  prompt_key: string;
  mode: 'agent';
  context_before: string;
  context_after: string;
  completion_length_hint: string;
  recent_rejections?: RejectionForApi[];
  behavior_summary?: BehaviorSummaryForApi;
  intent_key?: IntentPrediction['intent'];
  intent_confidence?: number;
  intent_constraints?: string[];
  history_mode: 'isolated';
  persist: false;
}

/**
 * 行为摘要（传递给后端的结构化数据）
 */
export interface BehaviorSummaryForApi {
  /** 总事件数 */
  totalEvents: number;
  /** 总插入字符数 */
  totalInsertedChars: number;
  /** 总删除字符数 */
  totalDeletedChars: number;
  /** 删除字符数（最近 60 秒） */
  recentDeletedChars?: number;
  /** 是否有大段删除 */
  hasLargeRecentDelete?: boolean;
  /** 打字速度（字符/秒） */
  typingSpeedCps?: number;
}

export interface AutocompleteRequestParams {
  /** 补全长度提示 */
  completionLengthHint: string;
  /** 拒绝反馈列表 */
  recentRejections: RejectionForApi[];
  /** 意图预测结果（可选） */
  intentPrediction?: IntentPrediction;
  /** 行为摘要（可选） */
  behaviorSummary?: BehaviorSummaryForApi;
}

export interface AutocompleteResponse {
  /** 生成的补全文本 */
  generatedText: string;
}

export class AutocompleteAiService {
  /**
   * 请求 AI 生成补全建议
   * @param editor Tiptap 编辑器实例
   * @param params 请求参数
   * @param signal AbortSignal 用于取消请求
   * @returns 生成的补全文本
   */
  static async requestSuggestion(
    editor: Editor,
    params: AutocompleteRequestParams,
    signal: AbortSignal
  ): Promise<AutocompleteResponse> {
    // 1. 收集上下文
    const { context_before: contextBefore, context_after: contextAfter } =
      await getAutocompleteStructuredContext(editor);

    // 2. 准备请求参数
    const requestData: AutocompleteApiRequest = {
      prompt: '', // 对于 autocomplete，prompt 通常为空，依赖上下文
      prompt_key: AUTOCOMPLETE_PROMPT_KEY,
      mode: 'agent',
      context_before: contextBefore ?? '',
      context_after: contextAfter ?? '',
      completion_length_hint: params.completionLengthHint,
      recent_rejections: params.recentRejections.length > 0 ? params.recentRejections : undefined,
      history_mode: 'isolated',
      persist: false,
    };

    // 3. 添加意图信息（阶段 C）
    if (params.intentPrediction) {
      requestData.intent_key = params.intentPrediction.intent;
      requestData.intent_confidence = params.intentPrediction.confidence;

      // 添加约束条件
      if (params.intentPrediction.policy.constraints && params.intentPrediction.policy.constraints.length > 0) {
        requestData.intent_constraints = params.intentPrediction.policy.constraints;
      }
    }

    // 4. 添加行为摘要（阶段 C）
    if (params.behaviorSummary) {
      requestData.behavior_summary = params.behaviorSummary;
    }

    // 5. 调用 AI 服务
    const response = await generateText(requestData, signal);

    // 6. 返回结果
    return {
      generatedText: response.generated_text || '',
    };
  }

  /**
   * 验证上下文是否足够
   * @param editor Tiptap 编辑器实例
   * @param minLength 最小上下文长度
   * @returns 是否有效
   */
  static async validateContext(editor: Editor, minLength: number): Promise<boolean> {
    const { context_before: contextBefore } = await getAutocompleteStructuredContext(editor);
    return !!(contextBefore && contextBefore.trim().length >= minLength);
  }
}
