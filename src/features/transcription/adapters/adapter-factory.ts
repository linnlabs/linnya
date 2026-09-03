/**
 * @file src/asr-adapters/adapter-factory.ts
 *
 * @brief ASR 适配器工厂
 *
 * @description
 * 根据模型配置自动选择合适的 ASR 适配器
 */

import { ASRAdapter, ResolvedTranscriptionModel } from './types';
import { WhisperAdapter } from './whisper-adapter';
import { QwenASRAdapter } from './qwen-asr-adapter';
import { Logger } from '@shared/logger';

const logger = new Logger('ASRAdapterFactory');

/**
 * ASR 适配器工厂
 *
 * @description
 * 适配器必须由模型配置显式声明，禁止通过模型名、供应商或 URL 猜测协议。
 */
export function createTranscriptionAdapter(config: ResolvedTranscriptionModel): ASRAdapter {
  logger.info(
    `[TranscriptionAdapterRegistry] 创建协议实现: model=${config.route.endpoint_model_id}, capability=${config.route.capability_id}`
  );

  switch (config.route.capability_id) {
    case 'host:dashscope-qwen-asr':
      return new QwenASRAdapter(config);
    case 'host:openai-audio-transcriptions':
      return new WhisperAdapter(config);
  }
  const unsupportedCapability: never = config.route;
  throw new Error(`未注册的转写 capability: ${String(unsupportedCapability)}`);
}
