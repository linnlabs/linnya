/**
 * @file src/audio-preprocessing/audioSaver.ts
 * 
 * @brief 音频保存器（无 FFmpeg 依赖）
 * 
 * @description
 * 负责将处理后的音频数据保存为文件（仅支持 WAV 格式）
 * 使用纯 JavaScript 实现 WAV 文件写入，无需外部依赖
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { AudioPreprocessingConfig } from './config';
import { AudioData, AudioSaveOptions } from './types';
import { Logger } from '@shared/logger';
import { pathManager } from '@shared/utils/pathManager';

const logger = new Logger('audioSaver');

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * 音频保存器类
 */
export class AudioSaver {
  private config: AudioPreprocessingConfig;

  constructor(config: AudioPreprocessingConfig) {
    this.config = config;
  }

  /**
   * 保存音频文件
   * 
   * @param audioData 音频波形数据
   * @param options 保存选项
   */
  async save(audioData: AudioData, options: AudioSaveOptions): Promise<void> {
    const { outputPath, sampleRate, format, overwrite = false } = options;

    logger.info(`保存音频到: ${outputPath}`);

    // 检查文件是否已存在
    if (!overwrite) {
      try {
        await fs.access(outputPath);
        throw new Error(`文件已存在: ${outputPath}。如需覆盖，请设置 overwrite: true`);
      } catch (error) {
        if (!isFileSystemError(error) || error.code !== 'ENOENT') {
          throw error;
        }
        // 文件不存在，可以继续
      }
    }

    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    // 仅支持 WAV 格式（无需 FFmpeg）
    const outputFormat = format || this.config.output.format;

    if (outputFormat !== 'wav') {
      throw new Error(`不支持的音频格式: ${outputFormat}。当前仅支持 WAV 格式。`);
    }

    await this.saveAsWav(audioData, outputPath, sampleRate);
    logger.info(`音频保存成功: ${outputPath}`);
  }

  /**
   * 保存为 WAV 格式（无需 FFmpeg）
   * 
   * @param audioData 音频数据
   * @param outputPath 输出路径
   * @param sampleRate 采样率
   */
  private async saveAsWav(audioData: AudioData, outputPath: string, sampleRate: number): Promise<void> {
    const { channels } = this.config;
    const numFrames = audioData.length / channels;
    const bytesPerSample = 2; // 16-bit PCM
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numFrames * blockAlign;
    const fileSize = 36 + dataSize;

    // 创建 WAV 文件 Buffer
    const buffer = Buffer.alloc(44 + dataSize);
    let offset = 0;

    // RIFF header
    buffer.write('RIFF', offset); offset += 4;
    buffer.writeUInt32LE(fileSize, offset); offset += 4;
    buffer.write('WAVE', offset); offset += 4;

    // fmt chunk
    buffer.write('fmt ', offset); offset += 4;
    buffer.writeUInt32LE(16, offset); offset += 4; // fmt chunk size
    buffer.writeUInt16LE(1, offset); offset += 2;  // audio format (PCM)
    buffer.writeUInt16LE(channels, offset); offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(16, offset); offset += 2; // bits per sample

    // data chunk
    buffer.write('data', offset); offset += 4;
    buffer.writeUInt32LE(dataSize, offset); offset += 4;

    // 写入音频数据（Float32 -> Int16）
    // audioData is assumed to be interleaved for multi-channel
    for (let i = 0; i < audioData.length; i++) {
      const sample = Math.max(-1, Math.min(1, audioData[i])); // 限幅
      const intSample = Math.round(sample * 32767);           // 转换为 16-bit
      buffer.writeInt16LE(intSample, offset);
      offset += 2;
    }

    // 写入文件
    await fs.writeFile(outputPath, buffer);
  }

  /**
   * 批量保存音频片段
   * 
   * @param audioSegments 音频片段列表
   * @param outputDir 输出目录
   * @param filePrefix 文件名前缀
   * @param sampleRate 采样率
   * @returns 保存的文件路径列表
   */
  async saveBatch(
    audioSegments: Array<{ data: AudioData; index: number }>,
    outputDir: string,
    filePrefix: string,
    sampleRate: number
  ): Promise<string[]> {
    logger.info(`批量保存 ${audioSegments.length} 个音频片段到: ${outputDir}`);

    const format = this.config.output.format;
    const savedPaths: string[] = [];

    await fs.mkdir(outputDir, { recursive: true });

    for (const segment of audioSegments) {
      const filename = `${filePrefix}_${String(segment.index).padStart(4, '0')}.${format}`;
      const outputPath = path.join(outputDir, filename);

      try {
        await this.save(segment.data, {
          outputPath,
          sampleRate,
          format,
          overwrite: true,
        });
        savedPaths.push(outputPath);
      } catch (error) {
        logger.error(`保存片段 ${segment.index} 失败: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    }

    logger.info(`批量保存完成: ${savedPaths.length} 个文件`);
    return savedPaths;
  }

  /**
   * 保存为临时文件
   * 
   * @param audioData 音频数据
   * @param sampleRate 采样率
   * @returns 临时文件路径
   */
  async saveTemporary(audioData: AudioData, sampleRate: number): Promise<string> {
    const tmpDir = path.join(pathManager.getUploadsPath(), 'temp');
    await fs.mkdir(tmpDir, { recursive: true });

    const format = this.config.output.format;
    const tmpFilename = `temp_audio_${Date.now()}_${Math.random().toString(36).slice(2)}.${format}`;
    const tmpPath = path.join(tmpDir, tmpFilename);

    await this.save(audioData, {
      outputPath: tmpPath,
      sampleRate,
      format,
      overwrite: true,
    });

    logger.info(`临时文件已创建: ${tmpPath}`);
    return tmpPath;
  }

  /**
   * 验证音频文件是否可写
   * 
   * @param outputPath 输出路径
   * @returns 是否可写
   */
  async canWrite(outputPath: string): Promise<boolean> {
    try {
      const dir = path.dirname(outputPath);
      await fs.access(dir, fs.constants.W_OK);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取输出文件的建议路径
   * 
   * @param inputPath 输入文件路径
   * @param outputDir 输出目录
   * @param suffix 后缀（例如 '_processed'）
   * @returns 建议的输出路径
   */
  getSuggestedOutputPath(inputPath: string, outputDir: string, suffix: string = '_processed'): string {
    const basename = path.basename(inputPath, path.extname(inputPath));
    const format = this.config.output.format;
    const filename = `${basename}${suffix}.${format}`;
    return path.join(outputDir, filename);
  }
}
