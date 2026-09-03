/**
 * @file src/transcription/routes/transcriptionRouter.ts
 * 
 * @brief 转录服务路由
 * 
 * @description
 * 提供音频转录的HTTP API接口：
 * - 音频文件上传和转录处理
 * - 自动判断使用短音频或长音频转录服务
 * - 支持多种音频格式（audio/*, WebM, MP4）
 * - 文件大小限制：22MB
 */

import { Router, Request, Response, NextFunction } from 'express';
import busboy from 'busboy';
import { 
  TranscriptionService,
  LongAudioTranscriptionService,
} from '../index';
import { Logger } from '@shared/logger';
import {
  TranscriptionAudioFileMissingError,
  TranscriptionServiceUnavailableError,
} from '../definitions/transcriptionErrors';
import { createTranscriptionOperationFailure } from '../definitions/transcriptionOperationFailure';
import { TranscriptionOptionsSchema, type TranscriptionOptions } from '../schemas';
import type { TranscriptionProgressPublisher } from '../definitions/transcriptionProgressPublisher';

const logger = new Logger('TranscriptionRouter');
const TRANSCRIPTION_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;

// 长音频转录阈值（秒）
const LONG_AUDIO_THRESHOLD_SECONDS = 180; // 3分钟
// 启发式判断的文件大小阈值（MB）
const HEURISTIC_FILE_SIZE_THRESHOLD_MB = 2;

interface UploadedAudioFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/**
 * 向前端发送转录进度
 */
function sendTranscriptionProgress(
  publish: TranscriptionProgressPublisher,
  stage: string,
  percent: number,
  message: string,
): void {
  try {
    publish({ stage, percent, message, timestamp: Date.now() });
  } catch (error: unknown) {
    // 进度 presentation 失败不能改写已经进行中的转录业务终态。
    logger.warn('发送转录进度失败:', error);
  }
}

/**
 * 创建转录服务路由
 * 
 * @param transcriptionService 短音频转录服务实例
 * @param longAudioService 长音频转录服务实例（可选，默认创建新实例）
 * @returns 配置好的Router实例
 */
export function createTranscriptionRouter(
  transcriptionService: TranscriptionService,
  publishProgress: TranscriptionProgressPublisher,
  longAudioService?: LongAudioTranscriptionService,
): Router {
  const router = Router();
  const uploadedFiles = new WeakMap<Request, UploadedAudioFile>();
  
  logger.info('初始化转录路由');
  
  // 使用传入的长音频服务或创建新实例
  const longAudioServiceInstance = longAudioService || new LongAudioTranscriptionService();

  /**
   * 统一错误处理
   */
  type TranscriptionFailureContext =
    | 'transcription.upload'
    | 'transcription.busboy'
    | 'transcription.transcribe';

  function handleError(error: unknown, res: Response, context: TranscriptionFailureContext) {
    logger.error(`${context}错误: ${error instanceof Error ? error.message : String(error)}`);
    
    const statusCode = error instanceof Error && 'statusCode' in error 
      ? (error as Error & { statusCode: number }).statusCode 
      : 500;
    const failure = createTranscriptionOperationFailure(error, 'system.transcription.failed');
    
    res.status(statusCode).json({
      ...failure,
      context,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 判断是否应该使用长音频转录服务
   * 完全基于音频时长和文件大小自动判断
   */
  function shouldUseLongAudioService(
    duration: number,
    fileSizeMB: number
  ): boolean {
    console.log(`[shouldUseLongAudioService] 判断参数: duration=${duration}s, fileSizeMB=${fileSizeMB.toFixed(2)}MB, threshold=${LONG_AUDIO_THRESHOLD_SECONDS}s`);
    
    // 1. 基于时长判断（优先）
    if (duration > LONG_AUDIO_THRESHOLD_SECONDS) {
      console.log(`[shouldUseLongAudioService] ✅ 时长判断: ${duration} > ${LONG_AUDIO_THRESHOLD_SECONDS}, 使用长音频服务`);
      return true;
    }
    
    // 2. 启发式判断：时长未知但文件较大
    // WebM 格式：2MB ≈ 5-6分钟，通常超过3分钟阈值
    if (duration === 0 && fileSizeMB > HEURISTIC_FILE_SIZE_THRESHOLD_MB) {
      console.log(`[shouldUseLongAudioService] ✅ 启发式判断为长音频（文件大小: ${fileSizeMB.toFixed(2)}MB）`);
      return true;
    }
    
    console.log(`[shouldUseLongAudioService] ❌ 判断为短音频`);
    return false;
  }

  // ==================== API 路由 ====================

  /**
   * 音频转录端点
   * @route POST /api/v1/transcription/transcribe
   */
  router.post('/transcribe',
    (req: Request, res: Response, next: NextFunction) => {
      logger.info(`转录上传请求到达, Content-Type=${req.headers['content-type']}`);
      
      const bb = busboy({
        headers: req.headers,
        limits: {
          fileSize: TRANSCRIPTION_UPLOAD_LIMIT_BYTES,
          files: 1,
        },
      });
      const fields: Record<string, string> = {};
      let fileInfo: UploadedAudioFile | null = null;
      let uploadLimitExceeded = false;

      bb.on('file', (name, file, info) => {
        const { filename, encoding, mimeType } = info;
        logger.info(`Busboy: 收到文件流: ${filename}, mimetype=${mimeType}`);
        
        const chunks: Buffer[] = [];
        let bytesWritten = 0;
        let fileSizeLimitReached = false;

        file.on('limit', () => {
          uploadLimitExceeded = true;
          fileSizeLimitReached = true;
          logger.warn(`Busboy: 音频文件超过转录上传大小限制: ${filename}, limit=${TRANSCRIPTION_UPLOAD_LIMIT_BYTES} bytes`);
        });
        
        file.on('data', (chunk) => {
          chunks.push(chunk);
          bytesWritten += chunk.length;
        });

        file.on('end', () => {
          if (fileSizeLimitReached || file.truncated) {
            logger.warn(`Busboy: 丢弃超限音频文件: ${filename}, received=${bytesWritten} bytes`);
            return;
          }

          logger.info(`Busboy: 文件 ${filename} 已接收完毕, ${bytesWritten} 字节`);
          fileInfo = {
            buffer: Buffer.concat(chunks),
            originalname: filename,
            size: bytesWritten
          };
        });
      });

      bb.on('field', (name, val) => {
        fields[name] = val;
      });

      bb.on('finish', () => {
        logger.info('Busboy: 表单解析完成');
        if (uploadLimitExceeded) {
          res.status(413).json({
            ...createTranscriptionOperationFailure(
              new Error(`音频文件大小超过限制：最大 ${TRANSCRIPTION_UPLOAD_LIMIT_BYTES} 字节`),
              'system.transcription.failed',
            ),
            context: 'transcription.upload',
            timestamp: new Date().toISOString(),
          });
          return;
        }

        if (fileInfo) {
          uploadedFiles.set(req, fileInfo);
          req.body = fields;
          next();
        } else {
          handleError(new TranscriptionAudioFileMissingError(), res, 'transcription.upload');
        }
      });

      bb.on('error', (err: Error) => {
        logger.error('Busboy 解析时发生错误:', err);
        return handleError(err, res, 'transcription.busboy');
      });

      req.pipe(bb);
    },
    async (req: Request, res: Response) => {
      try {
        if (!transcriptionService) {
          throw new TranscriptionServiceUnavailableError();
        }

        const file = uploadedFiles.get(req);
        logger.info(`Busboy处理完成: file=${file ? 'exists' : 'missing'}`);

        if (!file) {
          logger.error(`音频上传失败: busboy未接收到文件`);
          return res.status(400).json({
            ...createTranscriptionOperationFailure(
              new TranscriptionAudioFileMissingError(),
              'system.transcription.failed',
            ),
            context: 'transcription.upload',
            timestamp: new Date().toISOString(),
          });
        }

        // 提取请求参数
        const audioBuffer = file.buffer;
        const filename = file.originalname;
        const rawOptions: unknown = req.body.options ? JSON.parse(req.body.options) : {};
        const options: TranscriptionOptions = TranscriptionOptionsSchema.parse(rawOptions);
        const modelId = req.body.modelId || req.query.modelId as string;
        const duration = parseFloat(req.body.duration || req.query.duration || '0');
        const fileSizeMB = audioBuffer.length / (1024 * 1024);

        // 后端自动判断使用哪个转录服务（基于时长和文件大小）
        const useLongAudio = shouldUseLongAudioService(duration, fileSizeMB);

        logger.info(`转录: ${filename}, ${fileSizeMB.toFixed(2)}MB, ${duration.toFixed(1)}s, 长音频=${useLongAudio}, modelId=${modelId}`);

        if (useLongAudio) {
          // 发送开始信号
          sendTranscriptionProgress(publishProgress, 'start', 0, '开始处理长音频');
          
          // 长音频转录（带切分和合并）
          const result = await longAudioServiceInstance.transcribeFromBuffer(
            Buffer.from(audioBuffer),
            filename,
            {
              modelId,
              transcriptionParams: {
                language: options.language || 'zh',
                prompt: options.prompt,
                responseFormat: 'verbose_json',
                temperature: options.temperature,
              },
              // 不传递 segmentationParams，使用 DEFAULT_CONFIG
              mergeParams: {
                useTimestampMerging: true,
                useTextAlignmentMerging: true,
                textSimilarityThreshold: 0.5,
              },
              onProgress: (percent: number, stage: string, message: string) => {
                // percent 已经是 0-100 的总体进度
                logger.info(`[转录进度] ${percent.toFixed(1)}% - ${stage} - ${message}`);
                sendTranscriptionProgress(publishProgress, stage, percent, message);
              },
            }
          );
          
          // 发送完成信号
          sendTranscriptionProgress(publishProgress, 'done', 100, '转录完成');
          
          res.json({ 
            text: result.text,
            segments: result.segments,
            metadata: result.metadata,
            stats: {
              ...result.processStats,
              ...result.mergeStats,
            },
          });
        } else {
          // 短音频转录（直接转录）
          const result = await transcriptionService.transcribe(
            new Uint8Array(audioBuffer),
            filename,
            options,
            modelId
          );
          
          res.json({
            text: result.text,
            segments: result.segments,
            metadata: result.metadata,
          });
        }
      } catch (error) {
        handleError(error, res, 'transcription.transcribe');
      }
    }
  );

  return router;
}
