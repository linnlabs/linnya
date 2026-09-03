/**
 * @file src/transcription/transcriptionService.ts
 *
 * @brief [应用服务] 封装所有与音频转录相关的业务逻辑。
 *
 * @description
 * 该服务是 `features/transcription` 功能模块的核心实现。它主要负责：
 * 1. 接收来自上层的音频文件或路径。
 * 2. 检查文件格式和准备请求。
 * 3. 调用 Transcription feature 自有编排执行转录任务。
 * 4. 处理结果并返回。
 *
 * @dependency
 * - `orchestration/transcriptionEngine`: 转录模型解析与 ASR adapter 编排。
 * - `@shared`: 使用通用日志和类型。
 *
 * @relationship
 * - **内聚**: 高度内聚。所有逻辑都围绕"处理音频转录"这一职责。
 * - **耦合**:
 *   - **调用**: TranscriptionPort
 *   - **被调用**: 上层应用如Electron主进程
 */

import { logger } from '@shared/index';

import {
  TranscriptionRequest,
  TranscriptionOptions
} from './schemas';
import {
  formatTranscriptionResult,
  FormattedTranscriptionResult,
} from './utils/formatters';
import { transcriptionEngine as defaultTranscriptionPort } from './orchestration/transcriptionEngine';
import type { TranscriptionPort } from './definitions/transcriptionPort';

/**
 * 音频转录服务
 */
export class TranscriptionService {
  private readonly transcriptionPort: TranscriptionPort;

  /**
   * 构造函数
   * @param transcriptionPort Transcription feature 的窄能力合同
   */
  constructor(transcriptionPort: TranscriptionPort = defaultTranscriptionPort) {
    this.transcriptionPort = transcriptionPort;
    logger.info('TranscriptionService 初始化完成');
  }

  /**
   * 执行音频转录
   * @param audio 音频数据
   * @param filename 文件名
   * @param options 转录选项
   * @param modelId 模型ID（可选）
   * @returns 转录结果（包含格式化的 segments）
   */
  async transcribe(
    audio: Uint8Array,
    filename: string,
    options: TranscriptionOptions = {},
    modelId?: string
  ): Promise<FormattedTranscriptionResult> {
    try {
      logger.info(`执行音频转录，模型: '${modelId ?? '按策略选择'}', 文件: ${filename}`);

      // 准备转录参数
      // 优先使用 verbose_json 格式以获取时间戳信息
      const transcriptionParams = {
        language: options.language || 'zh',
        prompt: options.prompt || '这是一段中文音频。',
        responseFormat: options.responseFormat || 'verbose_json' // 改为 verbose_json
      };

      const transcriptionResult = await this.transcriptionPort.transcribe(
        modelId,
        audio,
        filename,
        transcriptionParams
      );

      logger.info(`转录成功，文本长度: ${transcriptionResult.text.length}`);

      // 使用格式转换器统一输出格式
      const formattedResult = formatTranscriptionResult(transcriptionResult, {
        createSingleSegmentIfEmpty: true,
        modelName: transcriptionResult.modelId,
      });

      logger.info(`格式化完成，生成了 ${formattedResult.segments.length} 个段落`);
      return formattedResult;
    } catch (error) {
      logger.error(`音频转录失败: ModelID='${modelId ?? '按策略选择'}', Error: ${error}`);
      throw error;
    }
  }

  /**
   * 通过文件路径执行音频转录
   * @param request 包含文件路径的转录请求
   * @param options 转录选项
   * @param modelId 模型ID（可选）
   * @returns 转录结果（包含格式化的 segments）
   */
  async transcribeFromPath(
    request: TranscriptionRequest,
    options: TranscriptionOptions = {},
    modelId?: string
  ): Promise<FormattedTranscriptionResult> {
    try {
      // 在实际实现中，这里应该使用Node.js的fs模块读取文件
      // 由于跨平台性和安全性考虑，这部分逻辑可能需要在Electron主进程中实现
      // 这里仅作为示例，实际应用中应提供完整实现

      throw new Error('Direct transcription from file path is not implemented');

      // 以下是示例实现
      /*
      import { promises as fs } from 'fs';

      const filePath = request.filePath;
      const fileName = filePath.split(/[\\/]/).pop() || 'audio.m4a';
      const fileData = await fs.readFile(filePath);

      return this.transcribe(
        new Uint8Array(fileData),
        fileName,
        options,
        modelId
      );
      */
    } catch (error) {
      logger.error(`从文件路径转录失败: ${request.filePath}, Error: ${error}`);
      throw error;
    }
  }
}

// 创建全局单例
export const transcriptionService = new TranscriptionService(); 
