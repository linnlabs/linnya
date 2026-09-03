/**
 * @file src/transcription/index.ts
 *
 * @brief [导出入口] 统一导出transcription模块的公共API。
 *
 * @description
 * 该文件集中导出transcription模块中所有需要对外暴露的类型、函数和服务实例。
 * 这确保了使用方只需要 `import {} from '@transcription'` 而不必了解内部文件结构。
 */

// 导出类型和Schema
export * from './schemas';
export type {
  TranscriptionOutput,
  TranscriptionParams,
  TranscriptionPort,
  TranscriptionResult,
  TranscriptionSegmentResult,
} from './definitions/transcriptionPort';

// 注意：配置相关接口仅供内部使用，前端无需关心

// 导出基础转录服务
export { TranscriptionService, transcriptionService } from './transcriptionService';

// 导出长音频转录服务
export {
  LongAudioTranscriptionService,
  createLongAudioTranscriptionService,
  transcribeLongAudio,
  type LongAudioTranscriptionOptions,
  type LongAudioTranscriptionResult,
} from './longAudioTranscriptionService';

// 导出转录合并器
export {
  TranscriptionMerger,
  mergeTranscriptions,
  type TranscriptionSegment,
  type MergeResult,
} from './transcriptionMerger';

// 导出格式转换器
export {
  formatTranscriptionResult,
  formatSegment,
  formatTimestamp,
  mergeFormattedResults,
  validateFormattedResult,
  type FormattedSegment,
  type FormattedTranscriptionResult,
  type RawASRSegment,
} from './utils/formatters';

// 导出路由
export { createTranscriptionRouter } from './routes/transcriptionRouter';

// 导出文本去重工具
export { 
  deduplicateText,
  CHINESE_DEDUP_PARAMS,
  ENGLISH_DEDUP_PARAMS,
} from './utils/textDeduplicator';
