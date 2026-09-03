/**
 * @file src/audio-preprocessing/index.ts
 * 
 * @brief 音频预处理模块统一导出
 * 
 * @description
 * 提供完整的音频预处理管道，包括：
 * 1. 加载音频（支持多种格式）
 * 2. VAD 智能切分
 * 3. 保存处理后的音频
 */

import * as path from 'path';
import { EventEmitter } from 'events';
import { AudioLoader } from './audioLoader';
import { VadProcessor } from './vadProcessor';
import { AudioSaver } from './audioSaver';
import {
  AudioPreprocessingConfig,
  DEFAULT_CONFIG,
  mergeConfig,
} from './config';
import {
  PreprocessingPipelineOptions,
  PreprocessingResult,
  AudioData,
  AudioSegment,
} from './types';
import { Logger } from '@shared/logger';
import { queueManager } from 'src/infra/task-queue/queues';

const logger = new Logger('audioPreprocessing');

interface StreamedAudioSegment {
  index: number;
  filePath: string;
  startTime: number;
  endTime: number;
  duration: number;
}

// 导出所有类型和配置
export * from './types';
export * from './config';
export { AudioLoader } from './audioLoader';
export { VadProcessor } from './vadProcessor';
export { AudioSaver } from './audioSaver';

/**
 * 音频预处理管道
 * 
 * @description
 * 完整的音频预处理流程，封装了加载、切分、保存的所有步骤
 */
export class AudioPreprocessingPipeline {
  private config: AudioPreprocessingConfig;
  private loader: AudioLoader;
  private vadProcessor: VadProcessor;
  private saver: AudioSaver;

  /**
   * 构造函数
   * 
   * @param userConfig 用户自定义配置（支持深度部分配置）
   */
  constructor(userConfig?: import('./config').DeepPartial<AudioPreprocessingConfig>) {
    this.config = mergeConfig(userConfig);
    this.loader = new AudioLoader(this.config);
    this.vadProcessor = new VadProcessor(this.config);
    this.saver = new AudioSaver(this.config);

    logger.info('音频预处理管道已初始化', {
      sampleRate: this.config.sampleRate,
      vadEnabled: this.config.segmentation.enableVadSegmentation,
      segmentThreshold: this.config.segmentation.segmentThresholdS,
      maxSegmentThreshold: this.config.segmentation.maxSegmentThresholdS,
    });
  }

  /**
   * 执行完整的预处理流程（流式处理）
   * 
   * @param options 管道选项
   * @returns 预处理结果
   */
  async process(options: PreprocessingPipelineOptions): Promise<PreprocessingResult> {
    const { inputPath, outputDir, returnAudioData = false, outputPrefix = 'segment', onProgress } = options;

    logger.info(`开始预处理音频（流式）: ${inputPath}`);

    return new Promise((resolve, reject) => {
      const segments: PreprocessingResult['segments'] = [];
      let totalDuration = 0;

      try {
        // 调用流式音频处理队列
        const emitter = queueManager.processAudio(inputPath, this.config);

        // 监听进度事件
        emitter.on('progress', (progressData: { percent: number; stage: string }) => {
          logger.info(`[流式处理] 音频解码进度: ${progressData.percent.toFixed(1)}%`);
          // 向上传递进度
          if (onProgress) {
            onProgress(progressData.percent, progressData.stage);
          }
        });

        // 监听片段事件
        emitter.on('segment', (segmentInfo: StreamedAudioSegment) => {
          logger.debug(`收到片段 ${segmentInfo.index}: ${segmentInfo.duration.toFixed(2)}s`);
          
          segments.push({
            index: segmentInfo.index,
            filePath: segmentInfo.filePath,
            startTime: segmentInfo.startTime,
            endTime: segmentInfo.endTime,
            duration: segmentInfo.duration,
            data: undefined,
          });
        });

        // 监听完成事件
        emitter.on('done', (doneData: { totalSegments: number; totalDuration: number }) => {
          totalDuration = doneData.totalDuration;

          // 计算统计信息
          const durations = segments.map(s => s.duration);
          const stats = {
            segmentCount: segments.length,
            avgSegmentDuration: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
            maxSegmentDuration: durations.length > 0 ? Math.max(...durations) : 0,
            minSegmentDuration: durations.length > 0 ? Math.min(...durations) : 0,
          };

          const result: PreprocessingResult = {
            segments,
            totalDuration,
            usedVad: false, // 流式处理使用固定切分
            stats,
          };

          logger.info('预处理完成（流式）', {
            totalDuration: result.totalDuration.toFixed(2),
            segmentCount: result.stats.segmentCount,
            avgDuration: result.stats.avgSegmentDuration.toFixed(2),
            usedVad: result.usedVad,
          });

          resolve(result);
        });

        // 监听错误事件
        emitter.on('error', (error: Error) => {
          logger.error(`预处理失败（流式）: ${error.message}`);
          reject(error);
        });

      } catch (error) {
        logger.error(`预处理失败: ${error instanceof Error ? error.message : String(error)}`);
        reject(error);
      }
    });
  }

  /**
   * 保存音频片段
   */
  private async saveSegments(
    segments: AudioSegment[],
    outputDir: string,
    prefix: string,
    sampleRate: number,
    returnData: boolean
  ): Promise<PreprocessingResult['segments']> {
    const format = this.config.output.format;
    const results: PreprocessingResult['segments'] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const filename = `${prefix}_${String(i).padStart(4, '0')}.${format}`;
      const filePath = path.join(outputDir, filename);

      await this.saver.save(segment.data, {
        outputPath: filePath,
        sampleRate,
        format,
        overwrite: true,
      });

      results.push({
        index: i,
        filePath,
        startTime: segment.startTime,
        endTime: segment.endTime,
        duration: segment.duration,
        data: returnData ? segment.data : undefined,
      });
    }

    return results;
  }

  /**
   * 仅加载音频（不进行切分）
   */
  async loadAudio(filePath: string): Promise<{
    data: AudioData;
    sampleRate: number;
    duration: number;
  }> {
    const result = await this.loader.load(filePath);
    return {
      data: result.data,
      sampleRate: result.sampleRate,
      duration: result.duration,
    };
  }

  /**
   * 仅对已加载的音频进行 VAD 处理
   */
  async processVad(audioData: AudioData, sampleRate: number) {
    return this.vadProcessor.process(audioData, sampleRate);
  }

  /**
   * 仅保存音频数据
   */
  async saveAudio(audioData: AudioData, outputPath: string, sampleRate: number) {
    await this.saver.save(audioData, {
      outputPath,
      sampleRate,
      overwrite: true,
    });
  }

  /**
   * 获取当前配置
   */
  getConfig(): AudioPreprocessingConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(partialConfig: import('./config').DeepPartial<AudioPreprocessingConfig>) {
    this.config = mergeConfig({ ...this.config, ...partialConfig });
    this.loader = new AudioLoader(this.config);
    this.vadProcessor = new VadProcessor(this.config);
    this.saver = new AudioSaver(this.config);
    logger.info('配置已更新');
  }
}

/**
 * 创建预处理管道的便捷函数
 * 
 * @param config 可选配置（支持深度部分配置）
 * @returns 管道实例
 */
export function createPipeline(config?: import('./config').DeepPartial<AudioPreprocessingConfig>): AudioPreprocessingPipeline {
  return new AudioPreprocessingPipeline(config);
}

/**
 * 快速预处理函数（使用默认配置）
 * 
 * @param inputPath 输入音频路径
 * @param outputDir 输出目录
 * @param options 额外选项
 * @returns 预处理结果
 */
export async function preprocessAudio(
  inputPath: string,
  outputDir: string,
  options?: {
    config?: import('./config').DeepPartial<AudioPreprocessingConfig>;
    outputPrefix?: string;
    returnAudioData?: boolean;
  }
): Promise<PreprocessingResult> {
  const pipeline = createPipeline(options?.config);
  return pipeline.process({
    inputPath,
    outputDir,
    outputPrefix: options?.outputPrefix,
    returnAudioData: options?.returnAudioData,
  });
}

// 导出默认管道实例
export const defaultPipeline = new AudioPreprocessingPipeline(DEFAULT_CONFIG);






