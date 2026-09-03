/**
 * @file src/features/transcription/adapters/qwen-asr-adapter.ts
 *
 * @brief Qwen ASR 适配器
 *
 * @description
 * 适配阿里云通义千问的 ASR API（qwen3-asr-flash）
 * 使用多模态对话 API 格式，而不是标准的 Whisper API
 */

import { ASRAdapter, ResolvedTranscriptionModel } from './types';
import type { TranscriptionOutput, TranscriptionParams } from '../definitions/transcriptionPort';
import { Logger } from '@shared/logger';
import * as path from 'path';
import { parseQwenAsrResponse } from '../functions/parseQwenAsrResponse';

const logger = new Logger('QwenASRAdapter');

/**
 * Qwen ASR 适配器
 *
 * @description
 * 阿里云 qwen3-asr-flash 使用特殊的 API 格式：
 * - 基于多模态对话 API
 * - 需要提供音频 URL（本实现先保存到临时目录，未来可集成 OSS）
 * - 使用 messages 数组格式
 * - 支持通过 asr_options 配置识别参数
 *
 * API 文档: https://help.aliyun.com/zh/dashscope/
 */
export class QwenASRAdapter implements ASRAdapter {
  provider: string;
  private config: ResolvedTranscriptionModel;

  constructor(config: ResolvedTranscriptionModel) {
    this.provider = config.route.endpoint_id;
    this.config = config;
    logger.info(`[QwenASRAdapter] 初始化: model=${config.route.endpoint_model_id}, api_surface=${config.route.api_surface}`);
  }

  async transcribe(
    audioData: Uint8Array | Buffer,
    filename: string,
    params: TranscriptionParams
  ): Promise<TranscriptionOutput> {
    logger.info(`[QwenASRAdapter] 开始转录: filename=${filename}, model=${this.config.route.endpoint_model_id}`);

    return this.callQwenAPI(audioData, filename, params);
  }

  /**
   * 根据文件路径获取 MIME 类型
   */
  private getMimeTypeFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();

    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.mp4': 'audio/mp4',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.webm': 'audio/webm',
      '.ogg': 'audio/ogg',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
    };

    return mimeTypes[ext] || 'audio/wav';
  }

  /**
   * 调用 Qwen ASR API
   */
  private async callQwenAPI(
    audioData: Uint8Array | Buffer,
    filename: string,
    params: TranscriptionParams
  ): Promise<TranscriptionOutput> {
    const audioBuffer = Buffer.from(audioData);
    const base64Audio = audioBuffer.toString('base64');

    // 根据文件扩展名确定 MIME 类型
    const mimeType = this.getMimeTypeFromPath(filename);
    const dataUri = `data:${mimeType};base64,${base64Audio}`;

    const messages = [
      ...(params.prompt
        ? [
            {
              role: 'system',
              content: [
                {
                  text: params.prompt,
                },
              ],
            },
          ]
        : []),
      {
        role: 'user',
        content: [
          {
            audio: dataUri,
          },
        ],
      },
    ];

    // ASR 选项
    const asrOptions: Record<string, boolean | string> = {
      enable_lid: true, // 启用语言识别
      enable_itn: false, // 禁用数字转换
    };

    // 如果指定了语言，添加到选项中
    if (params.language) {
      asrOptions.language = params.language === 'zh' ? 'zh' : params.language;
    }

    // 构建请求体
    const requestBody = {
      model: this.config.route.endpoint_model_id,
      input: {
        messages: messages,
      },
      parameters: {
        asr_options: asrOptions,
      },
    };

    // 构建 URL
    // 阿里云 DashScope API 使用 /services/aigc/multimodal-generation/generation
    const baseUrl = `${this.config.route.base_url}/`;
    const url = new URL('services/aigc/multimodal-generation/generation', baseUrl).toString();

    // 开发环境调试用（生产环境不输出）
    if (process.env.NODE_ENV === 'development') {
      console.log(`[QwenASR] 调用 API: ${url}`);
      console.log(`[QwenASR] 音频大小: ${(audioBuffer.length / 1024).toFixed(2)} KB`);
    }

    // 发送请求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.credential}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        `Qwen ASR API 请求失败: status=${response.status}, bodyBytes=${errorText.length}`
      );
      throw new Error(`Qwen ASR API 请求失败: ${response.status} ${response.statusText}`);
    }

    const responseData: unknown = await response.json();

    // 解析响应
    return parseQwenAsrResponse(responseData);
  }
}
