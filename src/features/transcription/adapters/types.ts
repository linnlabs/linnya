/**
 * @file src/asr-adapters/types.ts
 * 
 * @brief ASR 适配器类型定义
 * 
 * @description
 * 定义统一的 ASR 适配器接口，支持不同供应商的 API
 */

import type {
  TranscriptionOutput,
  TranscriptionParams,
} from '../definitions/transcriptionPort';
import type { TranscriptionRoute } from '@app/schemas/transcription';

/**
 * ASR 适配器接口
 * 
 * @description
 * 所有 ASR 适配器必须实现此接口，提供统一的转录方法
 */
export interface ASRAdapter {
  /**
   * 提供商名称
   */
  provider: string;

  /**
   * 转录音频
   * 
   * @param audioData 音频数据（Uint8Array 或 Buffer）
   * @param filename 文件名（用于推断格式）
   * @param params 转录参数
   * @returns 转录结果
   */
  transcribe(
    audioData: Uint8Array | Buffer,
    filename: string,
    params: TranscriptionParams
  ): Promise<TranscriptionOutput>;
}

/**
 * 模型配置
 */
export interface ResolvedTranscriptionModel {
  id: string;
  route: TranscriptionRoute;
  credential: string;
  display_name?: string;
}
