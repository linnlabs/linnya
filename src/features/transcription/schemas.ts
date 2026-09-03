/**
 * @file src/transcription/schemas.ts
 *
 * @brief [数据契约] 定义了音频转录功能的API请求和响应数据模型
 *
 * @description
 * 使用 Zod 来定义所有请求和响应的结构，确保类型安全和运行时验证。
 */

import { z } from 'zod';

/**
 * 转录请求模型
 */
export const TranscriptionRequestSchema = z.object({
  /**
   * 要转录的音频文件的完整本地路径
   */
  filePath: z.string().describe('要转录的音频文件的完整本地路径')
});

/**
 * 转录响应模型
 */
export const TranscriptionResponseSchema = z.object({
  /**
   * 转录后的文本内容
   */
  text: z.string().describe('转录后的文本内容')
});

/**
 * 转录选项模型
 */
export const TranscriptionOptionsSchema = z.object({
  /**
   * 要使用的语言 (可选)
   */
  language: z.string().optional().describe('要使用的语言，如 zh, en 等'),

  /**
   * 提示词，用于引导转录 (可选)
   */
  prompt: z.string().optional().describe('提示词，用于引导转录'),

  /**
   * 响应格式 (可选)
   */
  responseFormat: z.enum(['json', 'text', 'srt', 'verbose_json', 'vtt']).optional().describe('响应格式'),

  /**
   * 采样温度 (可选)
   */
  temperature: z.number().min(0).max(1).optional().describe('采样温度')
});

/**
 * 流式转录响应模型
 */
export const TranscriptionStreamChunkSchema = z.object({
  /**
   * 当前转录片段
   */
  text: z.string().describe('当前转录片段'),

  /**
   * 是否是最终片段
   */
  isFinal: z.boolean().optional().describe('是否是最终片段')
});

// 导出类型
export type TranscriptionRequest = z.infer<typeof TranscriptionRequestSchema>;
export type TranscriptionResponse = z.infer<typeof TranscriptionResponseSchema>;
export type TranscriptionOptions = z.infer<typeof TranscriptionOptionsSchema>;
export type TranscriptionStreamChunk = z.infer<typeof TranscriptionStreamChunkSchema>;
