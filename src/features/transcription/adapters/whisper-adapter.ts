/**
 * @file src/features/transcription/adapters/whisper-adapter.ts
 * 
 * @brief Whisper 适配器
 * 
 * @description
 * 适配标准的 OpenAI Whisper API 格式
 * 支持：OpenAI Whisper、feiai.chat 代理的 Whisper 等
 */

import { ASRAdapter, ResolvedTranscriptionModel } from './types';
import type {
  TranscriptionOutput,
  TranscriptionParams,
} from '../definitions/transcriptionPort';
import { Logger } from '@shared/logger';
import { parseOpenAiTranscriptionResponse } from '../functions/parseOpenAiTranscriptionResponse';

const logger = new Logger('WhisperAdapter');

/**
 * Whisper 适配器
 * 
 * @description
 * 使用标准的 OpenAI Whisper API 格式：
 * - POST /v1/audio/transcriptions
 * - FormData 上传
 * - 返回 JSON 或 verbose_json
 */
export class WhisperAdapter implements ASRAdapter {
  provider: string;
  private config: ResolvedTranscriptionModel;

  constructor(config: ResolvedTranscriptionModel) {
    this.provider = config.route.endpoint_id;
    this.config = config;
    logger.info(`[WhisperAdapter] 初始化: model=${config.route.endpoint_model_id}, api_surface=${config.route.api_surface}`);
  }

  async transcribe(
    audioData: Uint8Array | Buffer,
    filename: string,
    params: TranscriptionParams
  ): Promise<TranscriptionOutput> {
    logger.info(`[WhisperAdapter] 开始转录: filename=${filename}, model=${this.config.route.endpoint_model_id}`);

    // 构建 FormData
    const formData = new FormData();
    
    // 确定 MIME 类型
    const mimeType = this.getMimeTypeFromFilename(filename);
    const audioBlob = new Blob([audioData as BlobPart], { type: mimeType });
    
    formData.append('file', audioBlob, filename);
    formData.append('model', this.config.route.endpoint_model_id);

    // 添加可选参数
    if (params.language) {
      formData.append('language', params.language);
    }
    if (params.prompt) {
      formData.append('prompt', params.prompt);
    }
    if (params.responseFormat) {
      formData.append('response_format', params.responseFormat);
    }
    if (params.temperature !== undefined) {
      formData.append('temperature', params.temperature.toString());
    }

    // 构建 URL
    const baseUrl = `${this.config.route.base_url}/`;
    const url = new URL('audio/transcriptions', baseUrl).toString();

    console.debug(`[WhisperAdapter] 调用 API: ${url}`);

    // 发送请求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.credential}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`Whisper API 请求失败: status=${response.status}, bodyBytes=${errorText.length}`);
      throw new Error(
        `Whisper API 请求失败: ${response.status} ${response.statusText}`
      );
    }

    if (params.responseFormat === 'text' || params.responseFormat === 'srt' || params.responseFormat === 'vtt') {
      return { text: await response.text() };
    }

    const responseData: unknown = await response.json();
    return parseOpenAiTranscriptionResponse(responseData);
  }

  /**
   * 根据文件名获取 MIME 类型
   */
  private getMimeTypeFromFilename(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    
    const mimeTypes: Record<string, string> = {
      'mp3': 'audio/mpeg',
      'mp4': 'audio/mp4',
      'm4a': 'audio/mp4',
      'wav': 'audio/wav',
      'webm': 'audio/webm',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
      'aac': 'audio/aac',
    };

    return mimeTypes[ext || ''] || 'audio/webm';
  }

}
