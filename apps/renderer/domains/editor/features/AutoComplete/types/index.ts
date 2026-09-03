/**
 * @file AutoComplete/types/index.ts
 * @description 自动补全模块的共享类型定义
 */

import type { Editor } from '@tiptap/vue-3';

// ============================================
// 编辑器类型
// ============================================

/** 编辑器类型别名，方便模块内部使用 */
export type TiptapEditor = Editor;

// ============================================
// 上下文配置类型
// ============================================

/**
 * 自动补全上下文配置
 */
export interface AutocompleteContextConfig {
  /** 获取光标前的块数量 */
  blocksBefore: number;
  /** 获取光标后的块数量 */
  blocksAfter: number;
  /** 光标前文本的字符限制 */
  charsLimitBefore: number;
  /** 光标后文本的字符限制 */
  charsLimitAfter: number;
}

/**
 * 结构化上下文结果
 */
export interface AutocompleteStructuredContext {
  /** 光标前的上下文文本 */
  context_before: string | null;
  /** 光标后的上下文文本 */
  context_after: string | null;
}

// ============================================
// 拒绝反馈类型
// ============================================

/**
 * 被拒绝的建议记录
 */
export interface RejectedSuggestion {
  /** 被拒绝的建议文本（限100字符） */
  suggestionText: string;
  /** 建议显示的位置 */
  suggestionPos: number;
  /** 拒绝时间戳 */
  rejectedAt: number;
  /** 用户拒绝后继续输入的文本（限50字符） */
  userContinuedWith?: string;
}

/**
 * 用于 API 请求的拒绝反馈数据
 */
export interface RejectionForApi {
  /** 被拒绝的建议文本 */
  suggestionText: string;
  /** 用户拒绝后继续输入的文本 */
  userContinuedWith?: string;
}

// ============================================
// 自动补全配置常量
// ============================================

/**
 * 自动补全功能的全局配置
 */
export const AUTOCOMPLETE_CONFIG = {
  /** 拒绝反馈相关配置 */
  rejection: {
    /** 最多保留的拒绝记录数量 */
    maxSize: 2,
    /** 拒绝记录的过期时间（毫秒） */
    expiryMs: 120000, // 2分钟
    /** 建议文本的最大长度 */
    maxSuggestionLength: 100,
    /** 用户继续输入文本的最大长度 */
    maxUserContinuedLength: 50,
  },
  /** 触发相关配置 */
  trigger: {
    /** 触发补全所需的最短上下文长度 */
    minContextLength: 5,
    /** 默认防抖延迟（毫秒） */
    defaultDebounceMs: 1500,
  },
  /** 上下文获取配置 */
  context: {
    /** 获取光标前的块数量 */
    blocksBefore: 6,
    /** 获取光标后的块数量 */
    blocksAfter: 2,
    /** 光标前文本的字符限制 */
    charsLimitBefore: 360,
    /** 光标后文本的字符限制 */
    charsLimitAfter: 240,
  },
} as const;

// ============================================
// 补全长度类型
// ============================================

/**
 * 补全长度等级
 */
export type CompletionLengthLevel = 1 | 2 | 3;

/**
 * 补全长度配置
 */
export const COMPLETION_LENGTH_CONFIG: Record<CompletionLengthLevel, {
  promptHint: string;
}> = {
  1: {
    promptHint: 'Output exactly 1 short sentence.',
  },
  2: {
    promptHint: 'Output 2-3 sentences.',
  },
  3: {
    promptHint: 'Output a full paragraph.',
  },
};

// ============================================
// Store 类型
// ============================================

/**
 * AI 设置 Store 的最小接口
 * 用于避免与完整 Store 类型的紧耦合
 */
export interface AiSettingsStoreMinimal {
  isAutocompleteEnabled: boolean;
  isIntraParagraphCompletionEnabled: boolean;
  isProgrammaticallyDisabled: boolean;
  autocompleteDebounceMs: number;
  minTimeBetweenSuggestionsMs: number;
  completionLengthPromptHint: string;
  $subscribe?: (callback: (mutation: unknown, state: unknown) => void) => () => void;
}

/**
 * 自动补全扩展的 Storage 类型
 */
export interface AutocompleteStorage {
  isLoading: boolean;
  suggestion: string | null;
  suggestionPos: number | null;
  error: string | null;
  abortController: AbortController | null;
  aiSettingsStore: AiSettingsStoreMinimal | null;
  lastSuggestionShownTimestamp: number | null;
  placeholderPredicateRef: ((pmState: unknown) => boolean) | null;
}
