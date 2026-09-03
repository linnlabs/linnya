/**
 * @file src/transcription/utils/index.ts
 * 
 * @brief 转录工具集统一导出
 * 
 * @description
 * 集中导出转录相关的工具函数和类型
 */

// 导出文本去重工具
export {
  deduplicateText,
  CHINESE_DEDUP_PARAMS,
  ENGLISH_DEDUP_PARAMS,
} from './textDeduplicator';

// 导出格式转换工具
export {
  formatTranscriptionResult,
  formatSegment,
  formatTimestamp,
  mergeFormattedResults,
  validateFormattedResult,
  type FormattedSegment,
  type FormattedTranscriptionResult,
  type RawASRSegment,
} from './formatters';

