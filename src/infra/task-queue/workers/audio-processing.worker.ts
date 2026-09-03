/**
 * @file src/task-queue/workers/audio-processing.worker.ts
 * 
 * @brief 音频流式处理后台工作线程
 * 
 * @description
 * 在独立的线程中执行 CPU 密集型的音频解码、重采样和切分任务。
 * 采用流式处理架构，逐块读取和处理音频文件，保持内存占用恒定且可控。
 */

// ==================== 全局异常探针 ====================
// 增加这些探针是为了捕获那些可能导致 Worker 进程直接崩溃的底层错误，
// 特别是来自原生模块（如 prism-media）的异常，以便于诊断问题。
process.on('uncaughtException', (err, origin) => {
  console.error(`[AudioWorker] UNCAUGHT EXCEPTION:`, err);
  console.error(`[AudioWorker] Origin:`, origin);
  // 按照 Node.js 官方建议，发生未捕获异常后，进程应该退出
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[AudioWorker] UNHANDLED REJECTION at:`, promise);
  console.error(`[AudioWorker] Reason:`, reason);
  process.exit(1);
});
// ======================================================

import { parentPort } from 'worker_threads';
import { Transform } from 'stream';
import { promises as fs } from 'fs';
import * as path from 'path';
import { resample } from 'wave-resampler';
import type { AudioPreprocessingConfig } from '../../../features/transcription/audio-preprocessing/config';
import type {
  AudioProcessingWorkerInput,
  AudioProcessingWorkerOutput,
  AudioProcessingWorkerSegment,
} from '../definitions/audioProcessingWorkerProtocol';

// ==================== Dynamic Module Loading for Diagnostics ====================
// We dynamically require prism-media to catch potential native module loading errors
// that occur before any JavaScript code is executed. This is a last-resort diagnostic step.
interface PrismMediaModule {
  readonly opus: {
    readonly WebmDemuxer: new () => Transform;
    readonly Decoder: new (options: {
      readonly rate: number;
      readonly channels: number;
      readonly frameSize: number;
    }) => Transform;
  };
}

let prism: PrismMediaModule;
try {
  // Use require() instead of import to allow for programmatic error handling of load failures.
  const loadedPrism: unknown = require('prism-media');
  if (!isPrismMediaModule(loadedPrism)) {
    throw new Error('prism-media 未导出 opus WebmDemuxer/Decoder');
  }
  prism = loadedPrism;
} catch (error) {
  console.error('[AudioWorker] CRITICAL: Failed to load native module "prism-media". This is the likely cause of the crash.', error);
  if (parentPort) {
    const errorMessage = error instanceof Error ? error.stack : String(error);
    publish({
      type: 'failed',
      error: `[AudioWorker] Critical load error: ${errorMessage}`
    });
  }
  // Exit, as the worker cannot function without this module. The error is now logged.
  process.exit(1);
}
// ==============================================================================


if (!parentPort) {
  throw new Error('This script must be run as a worker thread.');
}

// ==================== 配置常量 ====================

/**
 * 每个"大块"的目标时长（秒）
 * 这决定了内存峰值占用：5分钟的 48kHz 单声道音频约占 28MB
 */
const CHUNK_DURATION_SECONDS = 300; // 5 分钟

/**
 * "大块"之间的重叠时长（秒）
 * 用于避免在边界处切断词语
 */
const CHUNK_OVERLAP_SECONDS = 5;

/**
 * 进度报告的最小间隔（毫秒）
 */
const PROGRESS_REPORT_INTERVAL_MS = 500;

// ==================== 类型定义 ====================

function publish(message: AudioProcessingWorkerOutput): void {
  parentPort?.postMessage(message);
}

function isPrismMediaModule(value: unknown): value is PrismMediaModule {
  if (typeof value !== 'object' || value === null) return false;
  const opus = Reflect.get(value, 'opus');
  if (typeof opus !== 'object' || opus === null) return false;
  return typeof Reflect.get(opus, 'WebmDemuxer') === 'function'
    && typeof Reflect.get(opus, 'Decoder') === 'function';
}

// ==================== 分块累积器 ====================

/**
 * PCM 数据分块累积器
 * 累积解码后的 PCM 数据，达到目标时长后触发处理
 */
class ChunkAccumulator extends Transform {
  private chunks: Buffer[] = [];
  private totalSamples = 0;
  private readonly targetSamples: number;
  private readonly overlapSamples: number;
  private previousChunkTail: Buffer | null = null;
  private globalOffset = 0; // 全局样本偏移量（用于计算绝对时间）

  constructor(
    private sampleRate: number,
    private onChunkReady: (pcmData: Buffer, startSample: number) => Promise<void>
  ) {
    super();
    this.targetSamples = CHUNK_DURATION_SECONDS * sampleRate;
    this.overlapSamples = CHUNK_OVERLAP_SECONDS * sampleRate;
  }

  async _transform(chunk: Buffer, encoding: string, callback: (error?: Error | null) => void) {
    try {
      this.chunks.push(chunk);
      this.totalSamples += chunk.length / 2; // 16-bit PCM

      // 检查是否达到目标大小
      if (this.totalSamples >= this.targetSamples) {
        await this.processAccumulatedChunk();
      }

      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  async _flush(callback: (error?: Error | null) => void) {
    try {
      // 处理最后剩余的数据
      if (this.totalSamples > 0) {
        await this.processAccumulatedChunk();
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  private async processAccumulatedChunk() {
    let pcmBuffer = Buffer.concat(this.chunks);

    // 如果有前一个块的尾部数据，添加到开头以形成重叠
    if (this.previousChunkTail) {
      pcmBuffer = Buffer.concat([this.previousChunkTail, pcmBuffer]);
    }

    // 保存当前块的尾部，用于下一个块的重叠
    const tailStartByte = Math.max(0, pcmBuffer.length - this.overlapSamples * 2);
    this.previousChunkTail = pcmBuffer.subarray(tailStartByte);

    // 处理这个大块
    const startSample = this.globalOffset;
    await this.onChunkReady(pcmBuffer, startSample);

    // 更新全局偏移量（不包括重叠部分）
    this.globalOffset += this.totalSamples;

    // 清空累积器
    this.chunks = [];
    this.totalSamples = 0;
  }
}

// ==================== 核心处理函数 ====================

/**
 * 对 PCM 数据进行重采样
 */
function resamplePCM(pcm48k: Buffer, targetSampleRate: number): Buffer {
  if (targetSampleRate === 48000) {
    return pcm48k;
  }

  const inputSamples = new Int16Array(
    pcm48k.buffer,
    pcm48k.byteOffset,
    pcm48k.length / 2
  );

  const outputSamples = resample(inputSamples, 48000, targetSampleRate, {
    method: 'sinc',
    LPF: true,
  });

  const outputArray = new Int16Array(outputSamples.length);
  for (let i = 0; i < outputSamples.length; i++) {
    outputArray[i] = Math.max(-32768, Math.min(32767, outputSamples[i]));
  }

  return Buffer.from(outputArray.buffer);
}

/**
 * 将 Int16 PCM 转换为 Float32
 */
function pcmToFloat32(pcmBuffer: Buffer): Float32Array {
  const samples = new Int16Array(
    pcmBuffer.buffer,
    pcmBuffer.byteOffset,
    pcmBuffer.length / 2
  );
  const audioData = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    audioData[i] = samples[i] / 32768.0;
  }
  return audioData;
}

/**
 * 简单的固定时长切分（VAD 的简化版本）
 */
function simpleSegmentation(
  audioData: Float32Array,
  sampleRate: number,
  startTimeOffset: number,
  config: AudioPreprocessingConfig
): Array<{ data: Float32Array; startTime: number; endTime: number; duration: number }> {
  const segmentThresholdSamples = Math.floor(config.segmentation.segmentThresholdS * sampleRate);
  const segments: Array<{ data: Float32Array; startTime: number; endTime: number; duration: number }> = [];

  let offset = 0;
  while (offset < audioData.length) {
    const segmentLength = Math.min(segmentThresholdSamples, audioData.length - offset);
    const segmentData = audioData.slice(offset, offset + segmentLength);
    
    const startTime = startTimeOffset + offset / sampleRate;
    const duration = segmentLength / sampleRate;
    const endTime = startTime + duration;

    segments.push({
      data: segmentData,
      startTime,
      endTime,
      duration,
    });

    offset += segmentLength;
  }

  return segments;
}

/**
 * 将 Float32Array 保存为 WAV 文件
 */
async function saveWAV(audioData: Float32Array, filePath: string, sampleRate: number): Promise<void> {
  // 转换为 Int16 PCM
  const pcmData = new Int16Array(audioData.length);
  for (let i = 0; i < audioData.length; i++) {
    const s = Math.max(-1, Math.min(1, audioData[i]));
    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }

  // 构建 WAV 文件头
  const dataSize = pcmData.length * 2;
  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size
  header.writeUInt16LE(1, 20); // AudioFormat (PCM)
  header.writeUInt16LE(1, 22); // NumChannels
  header.writeUInt32LE(sampleRate, 24); // SampleRate
  header.writeUInt32LE(sampleRate * 2, 28); // ByteRate
  header.writeUInt16LE(2, 32); // BlockAlign
  header.writeUInt16LE(16, 34); // BitsPerSample

  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const wavBuffer = Buffer.concat([header, Buffer.from(pcmData.buffer)]);
  await fs.writeFile(filePath, wavBuffer);
}

// ==================== 主处理流程 ====================

/**
 * 流式处理音频文件
 */
async function processAudioFile(filePath: string, config: AudioPreprocessingConfig, outputDir: string) {
  // 获取文件大小（用于进度计算）
  const stats = await fs.stat(filePath);
  const totalBytes = stats.size;
  let bytesProcessed = 0;
  let lastProgressReport = 0;

  // 创建输出目录
  await fs.mkdir(outputDir, { recursive: true });

  let globalSegmentIndex = 0;
  const allSegments: AudioProcessingWorkerSegment[] = [];

  // 发送开始消息
  console.log(`[AudioWorker] 开始流式处理音频: ${filePath}, 文件大小: ${(totalBytes / 1024 / 1024).toFixed(2)}MB`);
  publish({ type: 'started' });

  // 定义大块处理函数
  const onChunkReady = async (pcm48kBuffer: Buffer, startSample: number) => {
    // 重采样
    const pcmBuffer = resamplePCM(pcm48kBuffer, config.sampleRate);
    const audioData = pcmToFloat32(pcmBuffer);

    // 计算这个大块的起始时间偏移
    const startTimeOffset = startSample / 48000; // 48kHz 是解码后的原始采样率

    // 简单切分（固定时长）
    const segments = simpleSegmentation(audioData, config.sampleRate, startTimeOffset, config);

    // 保存每个小片段
    for (const segment of segments) {
      const filename = `segment_${String(globalSegmentIndex).padStart(4, '0')}.wav`;
      const segmentFilePath = path.join(outputDir, filename);

      await saveWAV(segment.data, segmentFilePath, config.sampleRate);

      const segmentInfo: AudioProcessingWorkerSegment = {
        index: globalSegmentIndex,
        filePath: segmentFilePath,
        startTime: segment.startTime,
        endTime: segment.endTime,
        duration: segment.duration,
      };

      allSegments.push(segmentInfo);

      // 发送片段完成消息
      publish({
        type: 'segment',
        segment: segmentInfo,
      });

      globalSegmentIndex++;
    }
  };

  // 创建流式管道
  const fileStream = require('fs').createReadStream(filePath);
  const demuxer = new prism.opus.WebmDemuxer();
  const decoder = new prism.opus.Decoder({
    rate: 48000,
    channels: config.channels,
    frameSize: 960,
  });
  const accumulator = new ChunkAccumulator(48000, onChunkReady);

  // 监听文件流进度
  fileStream.on('data', (chunk: Buffer) => {
    bytesProcessed += chunk.length;
    const now = Date.now();
    if (now - lastProgressReport >= PROGRESS_REPORT_INTERVAL_MS) {
      const percent = Math.min(100, (bytesProcessed / totalBytes) * 100);
      console.log(`[AudioWorker] 解码进度: ${percent.toFixed(1)}% (${(bytesProcessed / 1024 / 1024).toFixed(2)}MB / ${(totalBytes / 1024 / 1024).toFixed(2)}MB)`);
      publish({
        type: 'progress',
        percent,
        stage: 'decoding',
        bytesProcessed,
        totalBytes,
      });
      lastProgressReport = now;
    }
  });

  // 执行流式管道
  await new Promise<void>((resolve, reject) => {
    const stream = fileStream
      .pipe(demuxer)
      .pipe(decoder)
      .pipe(accumulator);

    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  // 计算总时长
  const totalDuration = allSegments.length > 0
    ? allSegments[allSegments.length - 1].endTime
    : 0;

  // 发送完成消息
  console.log(`[AudioWorker] 流式处理完成: 总时长 ${(totalDuration / 60).toFixed(1)}分钟, 生成 ${allSegments.length} 个片段`);
  publish({
    type: 'done',
    totalSegments: allSegments.length,
    totalDuration,
    stats: {
      segmentCount: allSegments.length,
      avgSegmentDuration: allSegments.length > 0 ? totalDuration / allSegments.length : 0,
    },
  });

  // 通知主线程后关闭通信通道，让 Worker 自然退出（避免额外的 terminate() 触发非零退出码）
  parentPort?.close();
}

// ==================== Worker 入口 ====================

parentPort.on('message', async (message: AudioProcessingWorkerInput) => {
  try {
    const { filePath, config } = message;

    // 创建临时输出目录
    const outputDir = path.join(path.dirname(filePath), `segments_${Date.now()}`);

    await processAudioFile(filePath, config, outputDir);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    publish({
      type: 'failed',
      error: `Audio processing worker failed: ${errorMsg}`,
    });
  }
});
