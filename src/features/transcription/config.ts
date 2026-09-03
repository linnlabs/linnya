/**
 * @file src/transcription/config.ts
 * 
 * @brief 转录模块配置
 * 
 * @description
 * 定义转录合并和去重的配置选项及默认值
 */

import { CHINESE_DEDUP_PARAMS, ENGLISH_DEDUP_PARAMS } from './utils/textDeduplicator';

/**
 * 文本去重配置（内部使用，不对外暴露）
 * @internal
 */
export interface DeduplicationConfig {
  charRepeatThreshold: number;
  patternRepeatThreshold: number;
  maxPatternLength: number;
}

/**
 * 文本对齐配置
 * @internal
 */
export interface TextAlignmentConfig {
  /** 最大搜索窗口字符数（用于文本对齐） */
  maxSearchWindowChars: number;
  /** 最小匹配字符数（低于此值认为对齐失败） */
  minMatchChars: number;
  /** 最小置信度（低于此值不采用对齐结果） */
  minConfidence: number;
}

/**
 * 转录合并配置（内部使用）
 * @internal
 */
export interface MergeConfig {
  overlapDurationS: number;
  textSimilarityThreshold?: number;
  useTimestampMerging?: boolean;
  useTextAlignmentMerging?: boolean;
  minSegmentDurationS?: number;
  maxSegmentDurationS?: number;
  
  /** 时间戳抖动容差（秒），用于判断句子是否在重叠区 */
  timestampJitterToleranceS?: number;
  /** 单词时间分桶大小（毫秒），用于单词级去重 */
  wordBucketMs?: number;
  /** 检测到时间戳回退时是否启用混合策略（文本对齐兜底） */
  useHybridWhenRegression?: boolean;
  /** 文本对齐配置 */
  textAlignment?: TextAlignmentConfig;
}

/**
 * 默认的去重配置（中文优化）
 * @internal
 */
const DEFAULT_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  charRepeatThreshold: CHINESE_DEDUP_PARAMS.charRepeatThreshold,
  patternRepeatThreshold: CHINESE_DEDUP_PARAMS.patternRepeatThreshold,
  maxPatternLength: CHINESE_DEDUP_PARAMS.maxPatternLength,
};

/**
 * 英文去重配置预设
 * @internal
 */
const ENGLISH_DEDUPLICATION_CONFIG: DeduplicationConfig = {
  charRepeatThreshold: ENGLISH_DEDUP_PARAMS.charRepeatThreshold,
  patternRepeatThreshold: ENGLISH_DEDUP_PARAMS.patternRepeatThreshold,
  maxPatternLength: ENGLISH_DEDUP_PARAMS.maxPatternLength,
};

/**
 * 默认的文本对齐配置
 * @internal
 */
const DEFAULT_TEXT_ALIGNMENT_CONFIG: TextAlignmentConfig = {
  maxSearchWindowChars: 200,
  minMatchChars: 12,
  minConfidence: 0.5,
};

/**
 * 默认的合并配置
 * @internal
 */
const DEFAULT_MERGE_CONFIG = {
  textSimilarityThreshold: 0.5,
  useTimestampMerging: true,
  useTextAlignmentMerging: true,
  minSegmentDurationS: 20,
  maxSegmentDurationS: 40,
  timestampJitterToleranceS: 0.3,
  wordBucketMs: 50,
  useHybridWhenRegression: true,
  textAlignment: DEFAULT_TEXT_ALIGNMENT_CONFIG,
};

/**
 * 根据语言自动选择去重配置
 * 
 * @param language 语言代码 ('zh', 'en' 等)，可选
 * @returns 对应语言优化的去重配置
 * 
 * @internal
 * @note 前端集成
 * - 当前：前端不传 language 参数，使用中文优化配置
 * - 未来：前端添加中英文选择后，传入 'zh' 或 'en'
 */
function getDeduplicationConfigByLanguage(language?: string): DeduplicationConfig {
  if (!language) {
    return DEFAULT_DEDUPLICATION_CONFIG;
  }

  const lang = language.toLowerCase();
  
  if (lang.startsWith('en')) {
    return ENGLISH_DEDUPLICATION_CONFIG;
  }
  
  return DEFAULT_DEDUPLICATION_CONFIG;
}

/**
 * 创建合并配置（根据语言自动选择去重配置）
 * 
 * @param config 基础配置
 * @param language 转录语言（'zh' 或 'en'，可选）
 * @returns 完整的合并配置
 * 
 * @internal
 */
export function createMergeConfig(
  config: MergeConfig, 
  language?: string
): Required<MergeConfig> & { deduplication: DeduplicationConfig } {
  const deduplicationConfig = getDeduplicationConfigByLanguage(language);

  return {
    overlapDurationS: config.overlapDurationS,
    textSimilarityThreshold: config.textSimilarityThreshold ?? DEFAULT_MERGE_CONFIG.textSimilarityThreshold,
    useTimestampMerging: config.useTimestampMerging ?? DEFAULT_MERGE_CONFIG.useTimestampMerging,
    useTextAlignmentMerging: config.useTextAlignmentMerging ?? DEFAULT_MERGE_CONFIG.useTextAlignmentMerging,
    minSegmentDurationS: config.minSegmentDurationS ?? DEFAULT_MERGE_CONFIG.minSegmentDurationS,
    maxSegmentDurationS: config.maxSegmentDurationS ?? DEFAULT_MERGE_CONFIG.maxSegmentDurationS,
    timestampJitterToleranceS: config.timestampJitterToleranceS ?? DEFAULT_MERGE_CONFIG.timestampJitterToleranceS,
    wordBucketMs: config.wordBucketMs ?? DEFAULT_MERGE_CONFIG.wordBucketMs,
    useHybridWhenRegression: config.useHybridWhenRegression ?? DEFAULT_MERGE_CONFIG.useHybridWhenRegression,
    textAlignment: config.textAlignment ?? DEFAULT_MERGE_CONFIG.textAlignment,
    deduplication: deduplicationConfig,
  };
}

