/**
 * @file src/features/transcription/adapters/index.ts
 * 
 * @brief ASR 适配器模块入口
 * 
 * @description
 * 导出所有 ASR 适配器和相关类型
 */

export * from './types';
export * from './whisper-adapter';
export * from './qwen-asr-adapter';
export * from './adapter-factory';

// 便捷导出
export { createTranscriptionAdapter } from './adapter-factory';
