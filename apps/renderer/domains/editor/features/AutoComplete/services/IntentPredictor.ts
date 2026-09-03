/**
 * IntentPredictor - 意图预测器（规则版）
 *
 * 职责：
 * - 基于特征提取器输出的特征，预测用户的编辑意图
 * - 输出 intentKey + confidence + generationPolicy
 * - 使用规则和打分器实现（阶段 1）
 */

import type { BehaviorTracker } from './BehaviorTracker'
import { FeatureExtractor } from './FeatureExtractor'
import type { EditorState } from 'prosemirror-state'

/**
 * 用户意图类型
 */
export type IntentKey =
  | 'continue_paragraph'              // 正常续写
  | 'list_next_item'                  // 继续列点
  | 'bridge_to_suffix_delimiter'      // 收束并衔接到后缀分隔符
  | 'rewrite_after_large_delete'      // 大删后重写（更保守）
  | 'structure_editing'               // 结构调整（不适合补全）
  // 注意：这里不包含“finish_sentence / uncertain”两类场景。
  // 这两类场景会引入“拒绝次数/犹豫”相关的耦合与额外冷却策略，当前版本已明确移除。

/**
 * 生成策略
 */
export interface GenerationPolicy {
  /** 是否应该触发补全 */
  shouldTrigger: boolean

  /** 建议的补全长度（1=短，2=中，3=长） */
  suggestedLength?: number

  /** 额外的冷却时间（毫秒），叠加在全局频率控制上 */
  additionalCooldownMs?: number

  /** 额外的约束（传递给 AI prompt） */
  constraints?: string[]
}

/**
 * 意图预测结果
 */
export interface IntentPrediction {
  /** 意图类型 */
  intent: IntentKey

  /** 置信度（0-1） */
  confidence: number

  /** 生成策略 */
  policy: GenerationPolicy

  /** 调试信息（可选） */
  debugInfo?: string
}

/**
 * 意图预测器配置
 */
export interface IntentPredictorConfig {
  /** 大删后重写的冷却时间（毫秒） */
  rewriteCooldownMs?: number

  /** 结构编辑的冷却时间（毫秒） */
  structureCooldownMs?: number

  /** 启用调试输出 */
  enableDebug?: boolean
}

const DEFAULT_CONFIG: Required<IntentPredictorConfig> = {
  rewriteCooldownMs: 2000,       // 大删后等待 2 秒
  structureCooldownMs: 3000,     // 结构编辑后等待 3 秒
  enableDebug: false,
}

export class IntentPredictor {
  private config: Required<IntentPredictorConfig>

  constructor(config?: IntentPredictorConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    }
  }

  /**
   * 预测用户意图
   */
  predict(
    tracker: BehaviorTracker,
    editorState: EditorState,
  ): IntentPrediction {
    // 提取特征
    const features = FeatureExtractor.extractAllFeatures(tracker, editorState)
    const { rhythm, distribution, structural, summary } = features

    let debugInfo = ''

    // 规则 1：继续列点（高优先级）
    if (structural.justTypedListMarker) {
      debugInfo = `List next item: justTypedListMarker=true`

      return {
        intent: 'list_next_item',
        confidence: 0.85,
        policy: {
          shouldTrigger: true,  // ✅ 应该触发，帮助生成列表项内容
          suggestedLength: 2,   // 中等补全
          constraints: [
            'Continue the list item naturally',
          ],
        },
        debugInfo: this.config.enableDebug ? debugInfo : undefined,
      }
    }

    // 规则 2：极大段删除（结构性删除，可能在重构）
    if (structural.hasLargeRecentDelete && structural.recentDeletedChars > 300) {
      debugInfo = `Structure editing: largeDelete=true (${structural.recentDeletedChars} chars)`

      return {
        intent: 'structure_editing',
        confidence: 0.9,
        policy: {
          shouldTrigger: false, // 不触发补全
          additionalCooldownMs: this.config.structureCooldownMs,
        },
        debugInfo: this.config.enableDebug ? debugInfo : undefined,
      }
    }

    // 规则 3：大删后重写（高优先级）
    if (structural.hasLargeRecentDelete && rhythm.pauseMsAfterBurst > 500) {
      debugInfo = `Rewrite after large delete: deletedChars=${structural.recentDeletedChars}, pause=${rhythm.pauseMsAfterBurst}ms`

      return {
        intent: 'rewrite_after_large_delete',
        confidence: 0.85,
        policy: {
          shouldTrigger: true, // 可以触发，但更保守
          suggestedLength: 1, // 短补全
          additionalCooldownMs: this.config.rewriteCooldownMs,
          constraints: [
            'Be conservative and brief',
            'Do not assume the previous direction',
          ],
        },
        debugInfo: this.config.enableDebug ? debugInfo : undefined,
      }
    }

    // 规则 4：收束并衔接到后缀分隔符
    if (structural.suffixStartsWithDelimiter && structural.cursorAtEndOfBlock) {
      debugInfo = `Bridge to suffix delimiter: cursorAtEnd=${structural.cursorAtEndOfBlock}`

      return {
        intent: 'bridge_to_suffix_delimiter',
        confidence: 0.8,
        policy: {
          shouldTrigger: true,
          suggestedLength: 1, // 短补全
          constraints: [
            'Output must smoothly transition to the delimiter',
            'Do not output new headings or delimiters',
          ],
        },
        debugInfo: this.config.enableDebug ? debugInfo : undefined,
      }
    }

    // 默认：正常续写
    debugInfo = `Continue paragraph (default): typingSpeed=${rhythm.typingSpeedCps.toFixed(2)} cps`

    return {
      intent: 'continue_paragraph',
      confidence: 0.7,
      policy: {
        shouldTrigger: true,
        suggestedLength: 2, // 中等补全
      },
      debugInfo: this.config.enableDebug ? debugInfo : undefined,
    }
  }

  /**
   * 获取意图的可读描述
   */
  static getIntentDescription(intent: IntentKey): string {
    const descriptions: Record<IntentKey, string> = {
      continue_paragraph: '正常续写段落',
      list_next_item: '继续列点',
      bridge_to_suffix_delimiter: '收束并衔接到后缀分隔符',
      rewrite_after_large_delete: '大删后重写',
      structure_editing: '结构调整',
    }
    return descriptions[intent] || intent
  }

  /**
   * 启用调试模式
   */
  enableDebug(enabled: boolean): void {
    this.config.enableDebug = enabled
  }
}
