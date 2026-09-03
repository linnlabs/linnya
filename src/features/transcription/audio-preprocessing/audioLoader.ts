/**
 * @file src/audio-preprocessing/audioLoader.ts
 * 
 * @brief 音频加载器（无 FFmpeg 依赖）
 * 
 * @description
 * 使用纯 JavaScript/N-API 技术栈加载和解码音频文件：
 * - WebM/Opus 解码（前端录音）: 使用 Worker 线程执行，避免阻塞主线程
 * - WAV 解析（VAD 切片）: 原生 JavaScript 解析
 * 
 * 完全移除了 FFmpeg 依赖，支持前端录音和后端 VAD 切片的完整流程。
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { AudioPreprocessingConfig } from './config';
import { AudioLoadResult } from './types';
import { Logger } from '@shared/logger';
import { pathManager } from '@shared/utils/pathManager';

const logger = new Logger('audioLoader');

/**
 * 音频加载器类
 */
export class AudioLoader {
  private config: AudioPreprocessingConfig;

  constructor(config: AudioPreprocessingConfig) {
    this.config = config;
  }

  /**
   * 从文件路径加载音频（支持 WebM/Opus 和 WAV）
   * 
   * @param filePath 音频文件路径（本地文件）
   * @returns 加载结果
   */
  async load(filePath: string): Promise<AudioLoadResult> {
    logger.info(`开始加载音频文件: ${filePath}`);

    try {
      // 读取文件
      const buffer = await fs.readFile(filePath);
      logger.info(`文件大小: ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

      // 使用 Buffer 加载方法
      return await this.loadFromBuffer(buffer, path.basename(filePath));
    } catch (error) {
      logger.error(`音频加载失败: ${error}`);
      throw new Error(`无法加载音频文件 '${filePath}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 检查 Buffer 是否为 WebM 格式
   * 
   * @param buffer 文件 Buffer
   * @returns 是否是 WebM
   */
  private isWebMBuffer(buffer: Buffer): boolean {
    // WebM 文件以 EBML 头开始: 0x1A45DFA3
    if (buffer.length < 4) return false;
    return (
      buffer[0] === 0x1A &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xDF &&
      buffer[3] === 0xA3
    );
  }

  /**
   * 检查 Buffer 是否为 WAV 格式
   * 
   * @param buffer 文件 Buffer
   * @returns 是否是 WAV
   */
  private isWAVBuffer(buffer: Buffer): boolean {
    // WAV 文件以 RIFF 头开始
    if (buffer.length < 12) return false;
    return (
      buffer[0] === 0x52 && // 'R'
      buffer[1] === 0x49 && // 'I'
      buffer[2] === 0x46 && // 'F'
      buffer[3] === 0x46 && // 'F'
      buffer[8] === 0x57 && // 'W'
      buffer[9] === 0x41 && // 'A'
      buffer[10] === 0x56 && // 'V'
      buffer[11] === 0x45    // 'E'
    );
  }

  /**
   * 从 WAV Buffer 直接加载（无需解码）
   * 
   * @param buffer WAV 文件 Buffer
   * @returns 加载结果
   */
  private async loadWAV(buffer: Buffer): Promise<AudioLoadResult> {
    const { sampleRate, channels } = this.config;
    logger.info(`加载 WAV 音频: ${(buffer.length / 1024).toFixed(2)} KB`);

    try {
      // 解析 WAV 文件头
      // RIFF header: 12 bytes
      // fmt chunk: 24 bytes (assuming standard PCM)
      // data chunk header: 8 bytes
      // Total header: 44 bytes (standard WAV)
      
      if (buffer.length < 44) {
        throw new Error('WAV 文件头不完整');
      }

      // 读取 fmt chunk 信息
      const audioFormat = buffer.readUInt16LE(20);
      const numChannels = buffer.readUInt16LE(22);
      const wavSampleRate = buffer.readUInt32LE(24);
      const bitsPerSample = buffer.readUInt16LE(34);

      logger.info(`WAV 格式: ${wavSampleRate}Hz, ${numChannels} 声道, ${bitsPerSample} bits`);

      // 只支持 16-bit PCM
      if (audioFormat !== 1 || bitsPerSample !== 16) {
        throw new Error(`不支持的 WAV 格式: format=${audioFormat}, bits=${bitsPerSample}。仅支持 16-bit PCM。`);
      }

      // 读取音频数据（从第 44 字节开始）
      const audioDataBuffer = buffer.slice(44);
      const numSamples = audioDataBuffer.length / 2; // 16-bit = 2 bytes per sample

      // 转换为 Int16Array
      const samples = new Int16Array(
        audioDataBuffer.buffer,
        audioDataBuffer.byteOffset,
        numSamples
      );

      // 转换为 Float32Array（归一化到 [-1, 1]）
      const audioData = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        audioData[i] = samples[i] / 32768.0;
      }

      const duration = audioData.length / wavSampleRate / numChannels;

      logger.info(`WAV 加载成功: ${duration.toFixed(2)}秒, ${wavSampleRate}Hz, ${numChannels}声道`);

      return {
        data: audioData,
        sampleRate: wavSampleRate,
        channels: numChannels,
        duration,
        originalFormat: 'wav',
        loadMethod: 'native',
      };
    } catch (error) {
      logger.error(`WAV 加载失败: ${error}`);
      throw new Error(`WAV 加载失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 从 Buffer 加载音频数据
   * 
   * @param buffer 音频数据 Buffer
   * @param originalFilename 原始文件名（用于推断格式）
   * @returns 加载结果
   */
  async loadFromBuffer(buffer: Buffer, originalFilename: string = 'audio.webm'): Promise<AudioLoadResult> {
    logger.info(`从 Buffer 加载音频: ${buffer.length} 字节, 文件名: ${originalFilename}`);

    // 检测格式并使用相应的加载器
    if (this.isWAVBuffer(buffer)) {
      logger.info('检测到 WAV 格式，使用原生加载器');
      return await this.loadWAV(buffer);
    } else if (this.isWebMBuffer(buffer)) {
      throw new Error('WebM/Opus 必须通过 AudioPreprocessingPipeline 的文件流 worker 处理');
    } else {
      throw new Error(`不支持的音频格式。当前支持: WebM/Opus (前端录音), WAV (VAD 切片)。`);
    }
  }

  /**
   * 从 Uint8Array 加载音频数据
   * 
   * @param data 音频数据
   * @param originalFilename 原始文件名
   * @returns 加载结果
   */
  async loadFromUint8Array(data: Uint8Array, originalFilename: string = 'audio.tmp'): Promise<AudioLoadResult> {
    const buffer = Buffer.from(data);
    return this.loadFromBuffer(buffer, originalFilename);
  }

  /**
   * 批量加载音频文件
   * 
   * @param filePaths 音频文件路径列表
   * @returns 加载结果列表
   */
  async loadBatch(filePaths: string[]): Promise<AudioLoadResult[]> {
    logger.info(`批量加载 ${filePaths.length} 个音频文件`);
    
    const results: AudioLoadResult[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    for (const filePath of filePaths) {
      try {
        const result = await this.load(filePath);
        results.push(result);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`加载文件失败 (${filePath}): ${errorMsg}`);
        errors.push({ path: filePath, error: errorMsg });
      }
    }

    if (errors.length > 0) {
      logger.warn(`批量加载完成，${results.length} 个成功，${errors.length} 个失败`);
    }

    return results;
  }

  /**
   * 验证音频格式是否受支持
   * 
   * @param filePath 文件路径
   * @returns 是否支持
   */
  isSupportedFormat(filePath: string): boolean {
    const supportedExtensions = [
      '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', 
      '.webm', '.opus', '.wma', '.mp4', '.avi', '.mkv'
    ];
    
    const ext = path.extname(filePath).toLowerCase();
    return supportedExtensions.includes(ext);
  }

  /**
   * 获取音频文件的基本信息（通过解码获取）
   * 
   * @param filePath 文件路径
   * @returns 音频信息
   */
  async getAudioInfo(filePath: string): Promise<{
    duration: number;
    format: string;
    sampleRate: number;
    channels: number;
    bitrate: number;
  }> {
    logger.info(`获取音频文件信息: ${filePath}`);
    
    // 加载并解码音频以获取信息
    const result = await this.load(filePath);
    
    return {
      duration: result.duration,
      format: result.originalFormat || 'webm',
      sampleRate: result.sampleRate,
      channels: result.channels,
      bitrate: 0, // WebM/Opus 是 VBR，无法预先知道精确比特率
    };
  }
}






