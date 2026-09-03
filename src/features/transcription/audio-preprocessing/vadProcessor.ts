/**
 * @file src/audio-preprocessing/vadProcessor.ts
 * 
 * @brief VAD (Voice Activity Detection) 处理器
 * 
 * @description
 * 使用 VAD 技术智能地切分音频：
 * 1. 检测语音活动段落
 * 2. 在静音处进行切分
 * 3. 确保每个片段在合理的时长范围内
 * 4. 失败时降级为固定时长切分
 * 
 * 当前实现使用短时能量检测；模型级 VAD 尚未进入运行时合同。
 */

import { AudioPreprocessingConfig } from './config';
import { AudioData, AudioSegment, SpeechTimestamp, VadProcessResult } from './types';
import { Logger } from '@shared/logger';

const logger = new Logger('vadProcessor');

/**
 * VAD 处理器类
 */
export class VadProcessor {
  private config: AudioPreprocessingConfig;

  constructor(config: AudioPreprocessingConfig) {
    this.config = config;
  }

  /**
   * 处理音频，进行智能切分
   * 
   * @param audioData 音频波形数据
   * @param sampleRate 采样率
   * @returns VAD 处理结果
   */
  async process(audioData: AudioData, sampleRate: number): Promise<VadProcessResult> {
    logger.info(`开始 VAD 处理: ${audioData.length} 采样点, ${(audioData.length / sampleRate).toFixed(2)}秒`);

    const { segmentation } = this.config;

    // 如果禁用了 VAD 或音频很短，直接使用固定切分
    const audioDuration = audioData.length / sampleRate;
    if (!segmentation.enableVadSegmentation || audioDuration <= segmentation.maxSegmentThresholdS) {
      logger.info('使用固定时长切分（VAD 已禁用或音频较短）');
      return this.fixedSegmentation(audioData, sampleRate);
    }

    try {
      // 尝试使用 VAD 进行智能切分
      const vadResult = await this.vadSegmentation(audioData, sampleRate);
      logger.info(`VAD 切分成功: ${vadResult.segments.length} 个片段`);
      return vadResult;
    } catch (error) {
      logger.warn(`VAD 处理失败，降级为固定切分: ${error instanceof Error ? error.message : String(error)}`);
      return this.fixedSegmentation(audioData, sampleRate);
    }
  }

  /**
   * 基于 VAD 的智能切分
   * 
   * @param audioData 音频数据
   * @param sampleRate 采样率
   * @returns VAD 处理结果
   */
  private async vadSegmentation(audioData: AudioData, sampleRate: number): Promise<VadProcessResult> {
    // 步骤 1: 检测语音时间戳
    const speechTimestamps = await this.detectSpeech(audioData, sampleRate);

    if (speechTimestamps.length === 0) {
      throw new Error('未检测到任何语音片段');
    }

    logger.info(`检测到 ${speechTimestamps.length} 个语音片段`);

    // 步骤 2: 构建潜在切分点
    const potentialSplitPoints = this.buildPotentialSplitPoints(speechTimestamps, audioData.length);

    // 步骤 3: 根据目标时长选择切分点
    const { segmentThresholdS, maxSegmentThresholdS } = this.config.segmentation;
    const segmentThresholdSamples = segmentThresholdS * sampleRate;
    const maxSegmentThresholdSamples = maxSegmentThresholdS * sampleRate;

    const finalSplitPoints = this.selectSplitPoints(
      potentialSplitPoints,
      segmentThresholdSamples,
      audioData.length
    );

    // 步骤 4: 确保没有片段超过最大时长
    const refinedSplitPoints = this.ensureMaxSegmentLength(
      finalSplitPoints,
      maxSegmentThresholdSamples,
      audioData.length
    );

    // 步骤 5: 生成音频片段
    const segments = this.createSegments(audioData, refinedSplitPoints, sampleRate);

    return {
      segments,
      speechTimestamps,
      usedVad: true,
      method: 'vad',
    };
  }

  /**
   * 固定时长切分（降级方案）
   * 
   * 独立实现固定时长的重叠切分，不依赖 createSegments
   * 确保每个片段的长度严格不超过 maxSegmentThresholdS
   * 
   * @param audioData 音频数据
   * @param sampleRate 采样率
   * @returns VAD 处理结果
   */
  private fixedSegmentation(audioData: AudioData, sampleRate: number): VadProcessResult {
    const { maxSegmentThresholdS, overlapS } = this.config.segmentation;
    const maxSegmentSamples = maxSegmentThresholdS * sampleRate;
    const overlapSamples = Math.floor(overlapS * sampleRate);
    
    // 步长 = 最大片段长度 - 重叠长度
    // 例如：maxSegmentThresholdS=180s, overlapS=5s
    //       stepSize=175s, 每次前进175s，但片段长度是180s，产生5s重叠
    const stepSize = maxSegmentSamples - overlapSamples;
    
    if (stepSize <= 0) {
      throw new Error(`Invalid segmentation config: maxSegmentThresholdS (${maxSegmentThresholdS}) must be greater than overlapS (${overlapS})`);
    }

    const segments: AudioSegment[] = [];
    let currentPosition = 0;

    while (currentPosition < audioData.length) {
      const startSample = currentPosition;
      // 片段结束位置 = 起始位置 + 最大长度，但不超过音频总长度
      const endSample = Math.min(currentPosition + maxSegmentSamples, audioData.length);
      
      const segmentData = audioData.slice(startSample, endSample);
      const startTime = startSample / sampleRate;
      const endTime = endSample / sampleRate;
      const duration = endTime - startTime;

      segments.push({
        startSample,
        endSample,
        data: segmentData,
        startTime,
        endTime,
        duration,
      });

      // 如果已经到达末尾，停止
      if (endSample === audioData.length) {
        break;
      }

      // 前进一个步长，准备下一个片段
      currentPosition += stepSize;
    }

    logger.info(`固定切分完成: ${segments.length} 个片段`);

    return {
      segments,
      speechTimestamps: [],
      usedVad: false,
      method: 'fixed',
    };
  }

  /**
   * 检测语音活动
   * 
   * @param audioData 音频数据
   * @param sampleRate 采样率
   * @returns 语音时间戳列表
   * 
   * @note
   * 这是一个接口方法，实际实现需要集成真实的 VAD 模型
   * 目前提供一个简单的能量检测作为示例
   */
  private async detectSpeech(audioData: AudioData, sampleRate: number): Promise<SpeechTimestamp[]> {
    // TODO: 集成真实的 VAD 模型（Silero VAD, WebRTC VAD 等）
    // 这里提供一个基于能量的简单实现作为示例

    const { vad } = this.config;
    const { minSpeechDurationMs, minSilenceDurationMs, threshold } = vad;

    const minSpeechSamples = Math.floor((minSpeechDurationMs / 1000) * sampleRate);
    const minSilenceSamples = Math.floor((minSilenceDurationMs / 1000) * sampleRate);

    // 计算短时能量（使用滑动窗口）
    const windowSize = Math.floor(0.025 * sampleRate); // 25ms 窗口
    const hopSize = Math.floor(0.010 * sampleRate);    // 10ms 跳跃

    const energyFrames: number[] = [];
    for (let i = 0; i < audioData.length - windowSize; i += hopSize) {
      let energy = 0;
      for (let j = 0; j < windowSize; j++) {
        energy += audioData[i + j] ** 2;
      }
      energyFrames.push(energy / windowSize); // 平均能量
    }

    // 计算自适应阈值
    const sortedEnergy = [...energyFrames].sort((a, b) => a - b);
    const medianEnergy = sortedEnergy[Math.floor(sortedEnergy.length / 2)];
    const adaptiveThreshold = medianEnergy * threshold;

    // 检测语音/静音段
    const isSpeech: boolean[] = energyFrames.map(e => e > adaptiveThreshold);

    // 平滑处理（去除短暂的切换）
    const smoothed = this.smoothVadDecisions(isSpeech, minSpeechSamples / hopSize, minSilenceSamples / hopSize);

    // 提取语音时间戳
    const timestamps: SpeechTimestamp[] = [];
    let inSpeech = false;
    let speechStart = 0;

    for (let i = 0; i < smoothed.length; i++) {
      const sampleIndex = i * hopSize;

      if (smoothed[i] && !inSpeech) {
        // 语音开始
        inSpeech = true;
        speechStart = sampleIndex;
      } else if (!smoothed[i] && inSpeech) {
        // 语音结束
        inSpeech = false;
        const speechEnd = sampleIndex;
        
        // 只保留足够长的语音段
        if (speechEnd - speechStart >= minSpeechSamples) {
          timestamps.push({
            start: speechStart,
            end: speechEnd,
          });
        }
      }
    }

    // 处理最后一段
    if (inSpeech) {
      timestamps.push({
        start: speechStart,
        end: audioData.length,
      });
    }

    return timestamps;
  }

  /**
   * 平滑 VAD 决策（去除短暂噪音和静音）
   */
  private smoothVadDecisions(
    decisions: boolean[],
    minSpeechFrames: number,
    minSilenceFrames: number
  ): boolean[] {
    const result = [...decisions];

    // 去除短暂的语音（噪音）
    for (let i = 0; i < result.length; i++) {
      if (result[i]) {
        let speechLength = 0;
        let j = i;
        while (j < result.length && result[j]) {
          speechLength++;
          j++;
        }
        if (speechLength < minSpeechFrames) {
          for (let k = i; k < j; k++) {
            result[k] = false;
          }
        }
        i = j - 1;
      }
    }

    // 填充短暂的静音
    for (let i = 0; i < result.length; i++) {
      if (!result[i]) {
        let silenceLength = 0;
        let j = i;
        while (j < result.length && !result[j]) {
          silenceLength++;
          j++;
        }
        if (silenceLength < minSilenceFrames && i > 0 && j < result.length) {
          for (let k = i; k < j; k++) {
            result[k] = true;
          }
        }
        i = j - 1;
      }
    }

    return result;
  }

  /**
   * 构建潜在的切分点集合
   */
  private buildPotentialSplitPoints(timestamps: SpeechTimestamp[], totalSamples: number): number[] {
    const points = new Set<number>();
    points.add(0);
    points.add(totalSamples);

    // 每个语音段的开始位置都是潜在切分点
    for (const timestamp of timestamps) {
      points.add(timestamp.start);
    }

    return Array.from(points).sort((a, b) => a - b);
  }

  /**
   * 根据目标时长选择切分点
   */
  private selectSplitPoints(
    potentialPoints: number[],
    targetSegmentSamples: number,
    totalSamples: number
  ): number[] {
    const selectedPoints = new Set<number>();
    selectedPoints.add(0);
    selectedPoints.add(totalSamples);

    let currentTarget = targetSegmentSamples;

    while (currentTarget < totalSamples) {
      // 找到最接近目标的潜在切分点
      let closestPoint = potentialPoints[0];
      let minDistance = Math.abs(potentialPoints[0] - currentTarget);

      for (const point of potentialPoints) {
        const distance = Math.abs(point - currentTarget);
        if (distance < minDistance) {
          minDistance = distance;
          closestPoint = point;
        }
      }

      selectedPoints.add(closestPoint);
      currentTarget += targetSegmentSamples;
    }

    return Array.from(selectedPoints).sort((a, b) => a - b);
  }

  /**
   * 确保没有片段超过最大时长
   */
  private ensureMaxSegmentLength(
    splitPoints: number[],
    maxSegmentSamples: number,
    totalSamples: number
  ): number[] {
    const result: number[] = [0];

    for (let i = 1; i < splitPoints.length; i++) {
      const start = splitPoints[i - 1];
      const end = splitPoints[i];
      const segmentLength = end - start;

      if (segmentLength <= maxSegmentSamples) {
        result.push(end);
      } else {
        // 需要进一步切分
        const numSubsegments = Math.ceil(segmentLength / maxSegmentSamples);
        const subsegmentLength = segmentLength / numSubsegments;

        for (let j = 1; j < numSubsegments; j++) {
          const splitPoint = Math.floor(start + j * subsegmentLength);
          result.push(splitPoint);
        }
        result.push(end);
      }
    }

    // 去重并排序
    return Array.from(new Set(result)).sort((a, b) => a - b);
  }

  /**
   * 根据切分点创建音频片段（支持重叠）
   * 
   * 用于 VAD 智能切分，切分点是基于语音活动检测的建议位置
   */
  private createSegments(
    audioData: AudioData,
    splitPoints: number[],
    sampleRate: number
  ): AudioSegment[] {
    const segments: AudioSegment[] = [];
    const { overlapS } = this.config.segmentation;
    const overlapSamples = Math.floor(overlapS * sampleRate);

    for (let i = 0; i < splitPoints.length - 1; i++) {
      // 基础切分点
      let startSample = splitPoints[i];
      let endSample = splitPoints[i + 1];

      // 应用重叠策略
      // 策略：每个片段向前扩展（即开始时间提前），这样相邻片段会有重叠
      if (overlapSamples > 0 && i > 0) {
        // 对于非第一个片段，向前扩展 overlap 长度
        startSample = Math.max(0, startSample - overlapSamples);
      }

      const segmentData = audioData.slice(startSample, endSample);

      const startTime = startSample / sampleRate;
      const endTime = endSample / sampleRate;
      const duration = endTime - startTime;

      segments.push({
        startSample,
        endSample,
        data: segmentData,
        startTime,
        endTime,
        duration,
      });
    }

    return segments;
  }

  /**
   * 获取 VAD 统计信息
   */
  getStats(result: VadProcessResult): {
    totalSegments: number;
    totalSpeechTime: number;
    speechRatio: number;
    avgSegmentDuration: number;
  } {
    const totalSegments = result.segments.length;
    const totalSpeechTime = result.speechTimestamps.reduce(
      (sum, ts) => sum + (ts.end - ts.start),
      0
    );
    const totalDuration = result.segments.reduce((sum, seg) => sum + seg.duration, 0);
    const speechRatio = totalDuration > 0 ? totalSpeechTime / totalDuration : 0;
    const avgSegmentDuration = totalSegments > 0 
      ? totalDuration / totalSegments 
      : 0;

    return {
      totalSegments,
      totalSpeechTime,
      speechRatio,
      avgSegmentDuration,
    };
  }
}
