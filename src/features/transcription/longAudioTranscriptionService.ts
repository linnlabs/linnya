/**
 * @file src/transcription/longAudioTranscriptionService.ts
 * 
 * @brief 长音频转录服务
 * 
 * @description
 * 编排完整的长音频转录流程：
 * 1. 调用 audio-preprocessing 进行重叠切分
 * 2. 调用 transcriptionEngine 转录每个片段
 * 3. 调用 transcriptionMerger 智能合并结果
 * 
 * 这是一个协调者（Orchestrator），不直接处理音频或转录逻辑
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { createPipeline } from './audio-preprocessing';
import { transcriptionEngine as defaultTranscriptionPort } from './orchestration/transcriptionEngine';
import type { TranscriptionPort } from './definitions/transcriptionPort';
import { TranscriptionMerger, TranscriptionSegment, MergeResult } from './transcriptionMerger';
import { Logger } from '@shared/logger';
import { pathManager } from '@shared/utils/pathManager';
import {
  formatTimestamp,
  FormattedSegment,
  FormattedTranscriptionResult,
} from './utils/formatters';

const logger = new Logger('longAudioTranscriptionService');

/**
 * 长音频转录选项
 */
export interface LongAudioTranscriptionOptions {
  /**
   * 模型ID
   */
  modelId?: string;

  /**
   * 转录参数
   */
  transcriptionParams?: {
    language?: string;
    prompt?: string;
    responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
    temperature?: number;
  };

  /**
   * 切分参数
   */
  segmentationParams?: {
    segmentThresholdS?: number;
    maxSegmentThresholdS?: number;
    overlapS?: number;
    enableVadSegmentation?: boolean;
  };

  /**
   * 合并参数（内部使用，前端无需传入）
   * @internal
   */
  mergeParams?: {
    textSimilarityThreshold?: number;
    useTimestampMerging?: boolean;
    useTextAlignmentMerging?: boolean;
  };

  /**
   * 临时文件目录（用于存放切分后的音频片段）
   */
  tempDir?: string;

  /**
   * 是否保留临时文件（调试用）
   */
  keepTempFiles?: boolean;

  /**
   * 进度回调
   * @param percent 总体进度百分比 (0-100)
   * @param stage 当前阶段标识 ('preprocessing' | 'transcribing' | 'merging')
   * @param message 进度消息
   */
  onProgress?: (percent: number, stage: string, message: string) => void;
}

/**
 * 长音频转录结果（继承自格式化结果，添加额外统计信息）
 */
export interface LongAudioTranscriptionResult extends FormattedTranscriptionResult {
  /**
   * 合并统计信息
   */
  mergeStats?: MergeResult['stats'];

  /**
   * 处理统计信息
   */
  processStats?: {
    totalAudioDuration: number;
    segmentCount: number;
    avgSegmentDuration: number;
    usedVad: boolean;
    mergeMethod: string;
    totalProcessingTime: number;
  };
}

/**
 * 长音频转录服务
 */
export class LongAudioTranscriptionService {
  private readonly transcriptionPort: TranscriptionPort;

  constructor(transcriptionPort: TranscriptionPort = defaultTranscriptionPort) {
    this.transcriptionPort = transcriptionPort;
  }

  /**
   * 转录长音频文件
   * 
   * @param audioPath 音频文件路径
   * @param options 转录选项
   * @returns 转录结果
   */
  async transcribe(
    audioPath: string,
    options: LongAudioTranscriptionOptions = {}
  ): Promise<LongAudioTranscriptionResult> {
    const startTime = Date.now();
    logger.info(`开始长音频转录: ${audioPath}`);

    // 计时器
    const timings = {
      preprocessing: 0,
      transcribing: 0,
      merging: 0,
      formatting: 0,
    };

    // 在外部定义 tempDir，确保 finally 块可以访问
    const tempDir = options.tempDir || path.join(pathManager.getTempDirectory(), `transcription_segments_${Date.now()}`);
    let shouldCleanup = false; // 标记是否已创建临时文件

    try {
      // 步骤 1: 音频预处理（切分）
      logger.info('步骤 1/3: 音频预处理（切分）');
      const preprocessingStartTime = Date.now();
      options.onProgress?.(0, 'preprocessing', '音频解码与切分中...');
      
      // 只传递用户明确指定的参数，其余使用 audio-preprocessing 的 DEFAULT_CONFIG
      // 这样保证了配置的单一数据源原则
      const pipeline = options.segmentationParams
        ? createPipeline({ segmentation: options.segmentationParams })
        : createPipeline();

      const preprocessResult = await pipeline.process({
        inputPath: audioPath,
        outputDir: tempDir,
        outputPrefix: 'segment',
        returnAudioData: false, // 不需要返回音频数据，直接从文件读取
        onProgress: (percent: number, stage: string) => {
          // 预处理阶段的进度：0-5% (根据实际耗时统计，预处理占约 4.7%)
          options.onProgress?.(percent * 0.05, 'preprocessing', `音频解码: ${percent.toFixed(0)}%`);
        },
      });

      timings.preprocessing = Date.now() - preprocessingStartTime;
      shouldCleanup = true; // 标记已创建临时文件，需要清理
      logger.info(`✅ 切分完成`);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[转录] 切分详情: ${preprocessResult.segments.length} 个片段, 耗时: ${(timings.preprocessing / 1000).toFixed(2)}秒`);
      }

      // 步骤 2: 转录每个片段
      logger.info('步骤 2/3: 转录各个片段');
      const transcribingStartTime = Date.now();

      const transcriptionSegments: TranscriptionSegment[] = [];

      for (let i = 0; i < preprocessResult.segments.length; i++) {
        const segment = preprocessResult.segments[i];
        
        // 转录进度：5% + (0-94%) = 5%-99% (根据实际耗时统计，转录占约 95.3%)
        const transcribingPercent = 5 + ((i / preprocessResult.segments.length) * 94);
        options.onProgress?.(transcribingPercent, 'transcribing', `语音转录: ${i + 1}/${preprocessResult.segments.length}`);
        
        logger.info(`转录片段 ${i + 1}/${preprocessResult.segments.length}...`);

        try {
          // 读取音频文件
          const audioBuffer = await fs.readFile(segment.filePath);
          
          // 转录
          const transcriptionResult = await this.transcriptionPort.transcribe(
            options.modelId,
            new Uint8Array(audioBuffer),
            segment.filePath,
            {
              language: options.transcriptionParams?.language || 'zh',
              prompt: options.transcriptionParams?.prompt,
              responseFormat: options.transcriptionParams?.responseFormat || 'verbose_json',
              temperature: options.transcriptionParams?.temperature,
            }
          );

          // 构建转录片段
          const transcriptionSegment: TranscriptionSegment = {
            index: i,
            text: transcriptionResult.text,
            audioStartTime: segment.startTime,
            audioEndTime: segment.endTime,
          };

          // 如果有详细的时间戳信息（verbose_json 格式）
          if (transcriptionResult.segments && transcriptionResult.segments.length > 0) {
            transcriptionSegment.segments = transcriptionResult.segments;
          }

          // TODO: 如果 ASR 支持单词级时间戳，可以在这里添加
          // transcriptionSegment.words = ...

          transcriptionSegments.push(transcriptionSegment);

          logger.info(`片段 ${i + 1} 转录完成`);
          
          if (process.env.NODE_ENV === 'development') {
            console.log(`[转录] 片段 ${i + 1} 详情: ${transcriptionResult.text.length} 字符`);
          }
        } catch (error) {
          logger.error(`转录片段 ${i + 1} 失败: ${error}`);
          throw new Error(`转录片段 ${i + 1} 失败: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      timings.transcribing = Date.now() - transcribingStartTime;
      logger.info(`✅ 转录完成`);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[转录] 转录详情: ${transcriptionSegments.length} 个片段, 耗时: ${(timings.transcribing / 1000).toFixed(2)}秒`);
      }

      // 步骤 3: 智能合并转录结果
      logger.info('步骤 3/3: 合并转录结果');
      const mergingStartTime = Date.now();
      options.onProgress?.(99, 'merging', '合并结果中...');

      // 从实际使用的 pipeline 配置中获取 overlapS 值
      const overlapS = options.segmentationParams?.overlapS ?? pipeline.getConfig().segmentation.overlapS;
      
      // 根据转录语言自动选择去重配置
      // 注意：如果前端未传 language 参数，会使用中文优化配置作为默认值
      const language = options.transcriptionParams?.language;
      
      const merger = new TranscriptionMerger({
        overlapDurationS: overlapS,
        textSimilarityThreshold: options.mergeParams?.textSimilarityThreshold,
        useTimestampMerging: options.mergeParams?.useTimestampMerging,
        useTextAlignmentMerging: options.mergeParams?.useTextAlignmentMerging,
      }, language);

      const mergeResult = await merger.merge(transcriptionSegments);

      timings.merging = Date.now() - mergingStartTime;
      logger.info(`✅ 合并完成`);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`[转录] 合并详情: ${mergeResult.text.length} 字符, 方法: ${mergeResult.method}, 耗时: ${(timings.merging / 1000).toFixed(2)}秒`);
      }

      // 步骤 4: 格式化为前端期望的格式
      logger.info('步骤 4/4: 格式化结果');
      const formattingStartTime = Date.now();
      options.onProgress?.(99.5, 'formatting', '格式化结果...');
      
      // 将合并后的文本转换为格式化的 segments
      // 注意：mergeResult.text 已经是合并去重后的文本
      // 我们需要从原始的 transcriptionSegments 中提取段落信息
      const formattedSegments: FormattedSegment[] = [];
      
      // 如果合并结果包含段落信息（使用了时间戳合并）
      if (mergeResult.mergedSegments && mergeResult.mergedSegments.length > 0) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[转录] 使用合并后的段落信息（时间戳合并）');
        }
        // 使用合并后的段落信息
        for (const mergedSeg of mergeResult.mergedSegments) {
          // 根据置信度对起始时间做轻微回退，减轻点击时间戳落在第二句的问题
          // high: 0.3s, medium: 0.5s, low/缺省: 0.8s
          const confidence = mergedSeg.confidence;
          const backoffS = confidence === 'high' ? 0.3 : confidence === 'medium' ? 0.5 : 0.8;
          const adjustedStart = Math.max(0, mergedSeg.startTime - backoffS);

          formattedSegments.push({
            text: mergedSeg.text.trim(),
            timestamp: formatTimestamp(adjustedStart),
            startTime: adjustedStart,
            endTime: mergedSeg.endTime,
          });
        }
      } else {
        // 降级方案：从原始 transcriptionSegments 中提取
        // 这种情况下可能有重叠，但至少保证有段落信息
        if (process.env.NODE_ENV === 'development') {
          console.log('[转录] 使用原始片段信息（文本对齐合并或无时间戳ASR）');
        }
        
        let hasDetailedTimestamps = false;
        for (const segment of transcriptionSegments) {
          if (segment.segments && segment.segments.length > 0) {
            // 如果有详细的句子级时间戳（Whisper verbose_json）
            hasDetailedTimestamps = true;
            for (const subSegment of segment.segments) {
              const absoluteStart = segment.audioStartTime + subSegment.start;
              const absoluteEnd = segment.audioStartTime + subSegment.end;
              formattedSegments.push({
                text: subSegment.text.trim(),
                timestamp: formatTimestamp(absoluteStart),
                startTime: absoluteStart,
                endTime: absoluteEnd,
              });
            }
          } else {
            // 没有详细时间戳，使用整个片段
            // 这是 Qwen ASR 等不支持时间戳的 ASR 引擎的正常行为
            // 用户仍然可以跳转到片段起始位置（粗粒度导航）
            formattedSegments.push({
              text: segment.text.trim(),
              timestamp: formatTimestamp(segment.audioStartTime),
              startTime: segment.audioStartTime,
              endTime: segment.audioEndTime,
            });
          }
        }
        
        if (!hasDetailedTimestamps && transcriptionSegments.length > 0) {
          const segmentThreshold = options.segmentationParams?.segmentThresholdS ?? pipeline.getConfig().segmentation.segmentThresholdS;
          logger.info(`⚠️  ASR 引擎未返回详细时间戳，已创建 ${transcriptionSegments.length} 个片段级时间戳（每个片段约 ${Math.round(segmentThreshold)}秒）`);
        }
      }
      
      // 按时间排序并去重（如果 merger 没有完全去重）
      const uniqueSegments = this.deduplicateSegments(formattedSegments);

      timings.formatting = Date.now() - formattingStartTime;

      // 构建最终结果
      const processingTime = Date.now() - startTime;
      const result: LongAudioTranscriptionResult = {
        text: mergeResult.text,
        segments: uniqueSegments,
        metadata: {
          language: options.transcriptionParams?.language,
          duration: preprocessResult.totalDuration,
          model: options.modelId,
        },
        mergeStats: mergeResult.stats,
        processStats: {
          totalAudioDuration: preprocessResult.totalDuration,
          segmentCount: preprocessResult.segments.length,
          avgSegmentDuration: preprocessResult.stats.avgSegmentDuration,
          usedVad: preprocessResult.usedVad,
          mergeMethod: mergeResult.method,
          totalProcessingTime: processingTime,
        },
      };

      options.onProgress?.(100, 'done', '转录完成');

      // 打印详细的耗时统计
      const totalSeconds = processingTime / 1000;
      const preprocessingPercent = (timings.preprocessing / processingTime * 100).toFixed(1);
      const transcribingPercent = (timings.transcribing / processingTime * 100).toFixed(1);
      const mergingPercent = (timings.merging / processingTime * 100).toFixed(1);
      const formattingPercent = (timings.formatting / processingTime * 100).toFixed(1);

      logger.info(`🎉 长音频转录完成`);

      if (process.env.NODE_ENV === 'development') {
        console.log(`[转录] 转录统计:`, {
          duration: preprocessResult.totalDuration.toFixed(2) + 's',
          segments: result.segments.length,
          textLength: result.text.length,
          totalTime: totalSeconds.toFixed(2) + 's',
        });

        console.log(`[转录] 耗时统计:`, {
          preprocessing: `${(timings.preprocessing / 1000).toFixed(2)}s (${preprocessingPercent}%)`,
          transcribing: `${(timings.transcribing / 1000).toFixed(2)}s (${transcribingPercent}%)`,
          merging: `${(timings.merging / 1000).toFixed(2)}s (${mergingPercent}%)`,
          formatting: `${(timings.formatting / 1000).toFixed(2)}s (${formattingPercent}%)`,
        });
      }

      return result;
    } catch (error) {
      logger.error(`长音频转录失败: ${error}`);
      throw error;
    } finally {
      // 清理临时文件（无论成功还是失败）
      if (shouldCleanup && !options.keepTempFiles) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
          if (process.env.NODE_ENV === 'development') {
            console.log('[转录] 临时文件清理完成');
          }
        } catch (error) {
          logger.warn(`清理临时文件失败: ${error}`);
        }
      } else if (options.keepTempFiles) {
        logger.info(`临时文件已保留在: ${tempDir}`);
      }
    }
  }

  /**
   * 从 Buffer 转录长音频
   * 
   * @param audioBuffer 音频数据
   * @param filename 文件名（用于推断格式）
   * @param options 转录选项
   * @returns 转录结果
   */
  async transcribeFromBuffer(
    audioBuffer: Buffer | Uint8Array,
    filename: string,
    options: LongAudioTranscriptionOptions = {}
  ): Promise<LongAudioTranscriptionResult> {
    // 创建临时文件
    const tempDir = options.tempDir || path.join(pathManager.getTempDirectory(), `transcription_temp_${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    const tempInputPath = path.join(tempDir, `input_${Date.now()}_${filename}`);
    
    try {
      // 写入临时文件
      await fs.writeFile(tempInputPath, audioBuffer);
      
      // 转录
      const result = await this.transcribe(tempInputPath, options);
      
      return result;
    } finally {
      // 清理输入临时文件
      try {
        await fs.unlink(tempInputPath);
      } catch (error) {
        logger.warn(`清理输入临时文件失败: ${tempInputPath}`);
      }
    }
  }

  /**
   * 去重段落（基于时间和文本相似度）
   * 
   * @param segments 段落列表
   * @returns 去重后的段落列表
   */
  private deduplicateSegments(segments: FormattedSegment[]): FormattedSegment[] {
    if (segments.length === 0) return [];
    
    const result: FormattedSegment[] = [];
    const seen = new Set<string>();
    
    for (const segment of segments) {
      // 创建唯一标识（基于时间和文本）
      const key = `${segment.startTime.toFixed(1)}-${segment.text.substring(0, 20)}`;
      
      if (!seen.has(key)) {
        result.push(segment);
        seen.add(key);
      }
    }
    
    return result;
  }

  /**
   * 估算转录所需时间
   * 
   * @param audioDurationS 音频时长（秒）
   * @param modelId 模型ID
   * @returns 估算的处理时间（秒）
   */
  estimateProcessingTime(audioDurationS: number, modelId?: string): number {
    // 根据经验值估算
    // Whisper 模型的转录速度大约是实时的 0.1-0.3 倍（取决于硬件）
    const transcriptionFactor = 0.2; // 假设转录时间是音频时长的 20%
    const overheadFactor = 1.3; // 加上切分、合并等开销
    
    return audioDurationS * transcriptionFactor * overheadFactor;
  }
}

/**
 * 创建长音频转录服务的便捷函数
 */
export function createLongAudioTranscriptionService(): LongAudioTranscriptionService {
  return new LongAudioTranscriptionService();
}

/**
 * 快速转录长音频（使用默认配置）
 */
export async function transcribeLongAudio(
  audioPath: string,
  modelId?: string,
  options?: Partial<LongAudioTranscriptionOptions>
): Promise<LongAudioTranscriptionResult> {
  const service = createLongAudioTranscriptionService();
  return service.transcribe(audioPath, {
    modelId,
    ...options,
  });
}
