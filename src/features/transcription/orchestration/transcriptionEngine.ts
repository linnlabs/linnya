/**
 * @file src/features/transcription/orchestration/transcriptionEngine.ts
 *
 * @brief 音频转录引擎，专门处理音频转录相关任务
 *
 * @description
 * 该模块专门负责音频转录功能，包括：
 * 1. 调用各种转录API（如Whisper、speech-to-text等）
 * 2. 处理音频文件格式转换
 * 3. 管理转录参数和配置
 * 4. 提供统一的转录接口
 * 5. 通过 ASR 适配器支持不同供应商的 API
 *
 * 该编排属于 Transcription feature，不通过宽 AIEngine 转发。
 */

import { modelCatalog, type ModelCatalog } from 'src/domains/model-catalog';
import { Logger } from 'src/shared/logger';
import { createTranscriptionAdapter } from '../adapters';
import { TRANSCRIPTION_MODEL_POLICY } from 'src/app-hosts/linnya/agent-registry/internals/transcription';
import { resolveModelIdFromPolicy } from 'src/app-hosts/linnya/agent-registry/modelPolicyResolver';
import type { ModelConfig as RegistryModelConfig } from 'src/domains/model-catalog';
import type { ResolvedTranscriptionModel } from '../adapters/types';
import type {
  TranscriptionParams,
  TranscriptionPort,
  TranscriptionResult,
} from '../definitions/transcriptionPort';
import { TranscriptionModelUnavailableError } from '../definitions/transcriptionErrors';

const logger = new Logger('transcriptionEngine');

function resolveTranscriptionModel(
  model: RegistryModelConfig,
  credential: string | undefined
): ResolvedTranscriptionModel {
  /**
   * 根因修复：
   * - ASR 适配器工厂只需要一组稳定字段；
   * - Model Catalog 的 ModelConfig 包含更多 UI/启用状态字段；
   * - 之前曾用宽断言绕过类型系统，这里改为显式映射，保证字段语义一致。
   */
  if (!model.transcription_route) {
    throw new Error(`转录模型 '${model.id}' 缺少 transcription_route`);
  }
  if (!credential?.trim()) {
    throw new Error(`转录模型 '${model.id}' 缺少凭据`);
  }
  return {
    id: model.id,
    route: model.transcription_route,
    credential,
    display_name: model.display_name,
  };
}

/**
 * 音频转录引擎类
 */
export class TranscriptionEngine implements TranscriptionPort {
  private modelCatalog: ModelCatalog;

  constructor(catalog: ModelCatalog = modelCatalog) {
    this.modelCatalog = catalog;
    logger.info('TranscriptionEngine initialized');
  }

  /**
   * 获取默认转录模型ID
   */
  private getDefaultTranscriptionModelId(): string {
    const resolved = resolveModelIdFromPolicy(TRANSCRIPTION_MODEL_POLICY, {
      resolveByCapability: (capability) => {
        return this.modelCatalog.getModelsByCapability(capability)[0]?.id;
      },
    });

    if (!resolved) {
      throw new TranscriptionModelUnavailableError();
    }

    logger.info(`使用默认转录模型: ${resolved}`);
    return resolved;
  }

  /**
   * 转录音频文件
   */
  async transcribe(
    modelId: string | undefined,
    audioFile: Uint8Array,
    filename: string,
    params: TranscriptionParams = {}
  ): Promise<TranscriptionResult> {
    try {
      // 确保模型注册表已初始化
      await this.modelCatalog.initialize();

      // 确定要使用的模型ID
      const finalModelId = modelId || this.getDefaultTranscriptionModelId();
      
      // 获取模型配置
      const modelConfig = this.modelCatalog.getModel(finalModelId);
      if (!modelConfig) {
        throw new Error(`转录模型 '${finalModelId}' 未找到`);
      }

      // 检查模型是否支持音频转录
      if (!modelConfig.capabilities.includes('audio_transcription')) {
        throw new Error(`模型 '${finalModelId}' 不支持音频转录功能`);
      }

      logger.info(`开始转录音频: ${filename}, 模型: ${modelConfig.display_name}, 文件大小: ${audioFile.length} bytes`);

      // 使用 ASR 适配器系统
      // 根据模型配置自动选择合适的适配器（Whisper、Qwen ASR 等）
      const adapter = createTranscriptionAdapter(
        resolveTranscriptionModel(modelConfig, this.modelCatalog.resolveCredential(finalModelId))
      );
      
      // 调用适配器进行转录
      const result = await adapter.transcribe(audioFile, filename, params);
      
      logger.info(`转录完成: ${result.text.length} 字符, 语言: ${result.language || 'unknown'}`);
      
      return {
        ...result,
        modelId: finalModelId,
      };

    } catch (error) {
      logger.error(`转录失败: ${error}`);
      throw error;
    }
  }

  // Note: getMimeTypeFromFilename 和 parseTranscriptionResponse 方法
  // 已移至各个 ASR 适配器中，以支持不同供应商的特定格式

  /**
   * 获取支持的音频格式列表
   */
  getSupportedFormats(): string[] {
    return ['mp3', 'mp4', 'm4a', 'wav', 'webm', 'ogg', 'flac', 'aac'];
  }

  /**
   * 验证音频文件格式
   */
  validateAudioFormat(filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop();
    return this.getSupportedFormats().includes(ext || '');
  }
}

// 创建全局单例
export const transcriptionEngine = new TranscriptionEngine();
