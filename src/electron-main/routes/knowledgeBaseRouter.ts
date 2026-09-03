/**
 * @file src/electron-main/routes/knowledgeBaseRouter.ts
 *
 * @brief 知识库管理路由
 *
 * @description
 * 功能 (What): 提供知识库的 HTTP API 接口，包括文档上传、知识库管理、搜索等功能
 * 输入 (Input): HTTP 请求（创建知识库、上传文档、搜索等）
 * 输出 (Output): JSON 响应或错误信息
 * 副作用 (Side-effects): 创建知识库、保存文档、触发异步处理任务
 */

import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import { createWriteStream, mkdirSync, unlink } from 'node:fs';
import { createHash, randomBytes } from 'crypto';
import iconv from 'iconv-lite';
import { pathManager } from '../../shared/utils/pathManager';
import { Logger } from '../../shared/logger';
import busboy from 'busboy';
import { readHistoricalCitationSnapshotBundle } from '../../domains/citation';
import {
  type KnowledgeBaseLookupPort,
  validatePdfOcrUploadPageLimit,
} from 'src/features/knowledge-base/ingestion/functions/pdfOcrUploadPageLimit';
import { DocumentOcrPageLimitError, type DocumentOcrPort } from 'src/domains/document-ocr';
import type { KnowledgeBaseService } from 'src/features/knowledge-base/application/knowledgeBaseService';

const router = Router();
const logger = new Logger('KnowledgeBaseRouter');
const DOCUMENT_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

interface UploadedTempFileInfo {
  path: string;
  originalname: string;
  size: number;
}

type KnowledgeBaseUploadRequest = Request & {
  file?: UploadedTempFileInfo;
};

function hasStatusCode(error: Error): error is HttpStatusError {
  const statusCode = Object.getOwnPropertyDescriptor(error, 'statusCode')?.value;
  return typeof statusCode === 'number';
}

function readAliasedBodyField(
  body: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): unknown {
  if (Object.prototype.hasOwnProperty.call(body, camelKey)) {
    return body[camelKey];
  }
  if (Object.prototype.hasOwnProperty.call(body, snakeKey)) {
    return body[snakeKey];
  }
  return undefined;
}

function toNullableModelId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * **功能 (What):** 修复文件名编码问题
 * **输入 (Input / @param):**
 * @param filename - 可能存在编码问题的文件名
 * **输出 (Output / @returns):** 正确编码的文件名
 * **副作用 (Side-effects):** 无副作用，纯编码转换函数
 */
function fixFilenameEncoding(filename: string): string {
  if (!filename) return filename;

  try {
    const buf = Buffer.from(filename, 'binary');
    const decoded = iconv.decode(buf, 'utf8');
    // 判断解码结果是否可读: 至少包含一个中文字符或全是ASCII
    const readable = /[\u4E00-\u9FFF]/.test(decoded) || /^[\x20-\x7E]+$/.test(decoded);
    if (readable && !decoded.includes('\ufffd')) {
      if (decoded !== filename) {
        console.log(`[文件名编码修复] "${filename}" -> "${decoded}"`);
      }
      return decoded;
    }
    return filename;
  } catch {
    return filename;
  }
}

/**
 * 功能 (What): 配置文件上传中间件
 * 输入 (Input): multipart/form-data 文件上传请求
 * 输出 (Output): 处理后的文件信息
 * 副作用 (Side-effects): 将上传的文件临时保存到系统临时目录
 */

/**
 * 功能 (What): 统一的错误处理函数
 * 输入 (Input): 错误对象和响应对象
 * 输出 (Output): 标准化的错误响应
 * 副作用 (Side-effects): 发送错误响应给客户端
 */
function handleKbError(error: unknown, res: Response, context: string): void {
  logger.error(`[KnowledgeBaseRouter] ${context} 错误:`, error);

  const errorMessage = error instanceof Error ? error.message : '未知错误';
  const statusCode =
    error instanceof DocumentOcrPageLimitError
      ? 422
      : error instanceof Error && hasStatusCode(error)
        ? error.statusCode
        : 500;

  res.status(statusCode).json({
    error: errorMessage,
    context,
    timestamp: new Date().toISOString(),
  });
}

/**
 * 功能 (What): 创建知识库路由
 * 输入 (Input): KnowledgeBaseService 实例
 * 输出 (Output): Express Router 实例
 * 副作用 (Side-effects): 注册所有知识库相关的 API 端点
 */
export function createKnowledgeBaseRouter(
  kbService: KnowledgeBaseService,
  kbLookup: KnowledgeBaseLookupPort,
  documentOcr: DocumentOcrPort
): Router {
  // Bootstrap 安装 RuntimePathRoots 后才允许解析持久化路径；模块求值阶段不能触碰宿主配置。
  const tempUploadPath = path.join(pathManager.getUploadsPath(), 'temp');
  mkdirSync(tempUploadPath, { recursive: true });
  logger.info(`初始化知识库路由, uploadPath=${tempUploadPath}`);

  // ==================== 知识库管理 API ====================

  /**
   * 获取所有知识库列表
   * @route GET /knowledge-base
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      console.log('[KnowledgeBaseRouter] 获取知识库列表请求');
      const knowledgeBases = await kbService.getAllKnowledgeBases();

      res.json({
        knowledge_bases: knowledgeBases,
        total: knowledgeBases.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleKbError(error, res, '获取知识库列表');
    }
  });

  /**
   * 创建新知识库
   * @route POST /knowledge-base
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      console.log('[KnowledgeBaseRouter] 创建知识库请求:', req.body);

      const { name, description } = req.body;

      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: '知识库名称不能为空' });
      }

      const knowledgeBase = await kbService.createKnowledgeBase(name, description);

      res.status(201).json({
        knowledge_base: knowledgeBase,
        message: '知识库创建成功',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleKbError(error, res, '创建知识库');
    }
  });

  /**
   * 更新知识库基础信息 / 模型配置 / 标签
   * @route PATCH /knowledge-base/:kbId/settings
   */
  router.patch('/:kbId/settings', async (req: Request, res: Response) => {
    try {
      const { kbId } = req.params;
      const { name, description, tags } = req.body || {};
      const body = (req.body || {}) as Record<string, unknown>;
      const embeddingModelIdRaw = readAliasedBodyField(
        body,
        'embeddingModelId',
        'embedding_model_id'
      );
      const rerankModelIdRaw = readAliasedBodyField(body, 'rerankModelId', 'rerank_model_id');
      const pdfOcrModelIdRaw = readAliasedBodyField(body, 'pdfOcrModelId', 'pdf_ocr_model_id');
      const imageVisionModelIdRaw = readAliasedBodyField(
        body,
        'imageVisionModelId',
        'image_vision_model_id'
      );
      const visionModelIdRaw = readAliasedBodyField(body, 'visionModelId', 'vision_model_id');
      const enableGraphIndexingRaw = readAliasedBodyField(
        body,
        'enableGraphIndexing',
        'enable_graph_indexing'
      );

      logger.info(
        `[KnowledgeBaseRouter] 更新知识库配置请求: kbId=${kbId}, payload=${JSON.stringify({
          name,
          hasDescription: typeof description === 'string',
          hasEmbeddingModel:
            typeof embeddingModelIdRaw === 'string' && embeddingModelIdRaw.length > 0,
          hasRerankModel: typeof rerankModelIdRaw === 'string' && rerankModelIdRaw.length > 0,
          hasPdfOcrModel: typeof pdfOcrModelIdRaw === 'string' && pdfOcrModelIdRaw.length > 0,
          hasImageVisionModel:
            typeof imageVisionModelIdRaw === 'string' && imageVisionModelIdRaw.length > 0,
          hasVisionModel: typeof visionModelIdRaw === 'string' && visionModelIdRaw.length > 0,
          tagsLength: Array.isArray(tags) ? tags.length : undefined,
        })}`
      );

      if (!kbId || typeof kbId !== 'string') {
        return res.status(400).json({ error: '知识库 ID 不能为空' });
      }

      // 构造协调器需要的 payload，字段名与应用层接口对齐
      const payload: {
        name?: string;
        description?: string | null;
        embeddingModelId?: string | null;
        rerankModelId?: string | null;
        pdfOcrModelId?: string | null;
        imageVisionModelId?: string | null;
        visionModelId?: string | null;
        tags?: string[];
        enableGraphIndexing?: boolean;
      } = {};

      if (typeof name === 'string') {
        payload.name = name.trim();
      }

      if (description !== undefined) {
        // 允许显式传 null / 空字符串 清空描述
        payload.description = typeof description === 'string' ? description : null;
      }

      const embeddingModelId = toNullableModelId(embeddingModelIdRaw);
      if (embeddingModelId !== undefined) {
        payload.embeddingModelId = embeddingModelId;
      }

      const rerankModelId = toNullableModelId(rerankModelIdRaw);
      if (rerankModelId !== undefined) {
        payload.rerankModelId = rerankModelId;
      }

      const pdfOcrModelId = toNullableModelId(pdfOcrModelIdRaw);
      if (pdfOcrModelId !== undefined) {
        payload.pdfOcrModelId = pdfOcrModelId;
      }

      const imageVisionModelId = toNullableModelId(imageVisionModelIdRaw);
      if (imageVisionModelId !== undefined) {
        payload.imageVisionModelId = imageVisionModelId;
      }

      const visionModelId = toNullableModelId(visionModelIdRaw);
      if (visionModelId !== undefined) {
        payload.visionModelId = visionModelId;
      }

      if (Array.isArray(tags)) {
        payload.tags = tags.filter(
          (t: unknown): t is string => typeof t === 'string' && t.trim().length > 0
        );
      }

      if (typeof enableGraphIndexingRaw === 'boolean') {
        payload.enableGraphIndexing = enableGraphIndexingRaw;
      }

      const updatedKb = await kbService.updateKnowledgeBaseSettings(kbId, payload);

      res.json({
        knowledge_base: updatedKb,
        message: '知识库配置已更新',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleKbError(error, res, '更新知识库配置');
    }
  });

  /**
   * 删除知识库
   * @route DELETE /knowledge-base/:kbId
   */
  router.delete('/:kbId', async (req: Request, res: Response) => {
    try {
      const { kbId } = req.params;
      console.log(`[KnowledgeBaseRouter] 删除知识库请求: ${kbId}`);

      await kbService.deleteKnowledgeBase(kbId);

      res.status(204).send();
    } catch (error) {
      handleKbError(error, res, '删除知识库');
    }
  });

  // ==================== 文档管理 API ====================

  /**
   * 上传文档到指定知识库
   * @route POST /knowledge-base/:kbId/documents
   */
  router.post(
    '/:kbId/documents',
    (req: Request, res: Response, next: NextFunction) => {
      logger.info(
        `文档上传请求到达: kbId=${req.params.kbId}, Content-Type=${req.headers['content-type']}`
      );

      const bb = busboy({
        headers: req.headers,
        limits: {
          fileSize: DOCUMENT_UPLOAD_LIMIT_BYTES,
          files: 1,
        },
      });
      const fields: Record<string, string> = {};

      // 使用 Promise 来处理异步文件写入
      const fileWritePromise = new Promise<UploadedTempFileInfo>((resolve, reject) => {
        bb.on('file', (name, file, info) => {
          const { filename, encoding, mimeType } = info;
          logger.info(`Busboy: 收到文件流: ${filename}, mimetype=${mimeType}`);

          const tempFilePath = path.join(tempUploadPath, randomBytes(16).toString('hex'));
          const writeStream = createWriteStream(tempFilePath);
          let fileSizeLimitReached = false;

          let bytesWritten = 0;
          file.on('limit', () => {
            fileSizeLimitReached = true;
            logger.warn(
              `Busboy: 文件超过上传大小限制: ${filename}, limit=${DOCUMENT_UPLOAD_LIMIT_BYTES} bytes`
            );
          });

          file.on('data', chunk => {
            bytesWritten += chunk.length;
            writeStream.write(chunk);
          });

          file.on('end', () => {
            writeStream.end(() => {
              if (fileSizeLimitReached || file.truncated) {
                unlink(tempFilePath, () => {});
                reject(
                  new HttpStatusError(
                    `文件大小超过限制：最大 ${DOCUMENT_UPLOAD_LIMIT_BYTES} 字节`,
                    413
                  )
                );
                return;
              }

              logger.info(`Busboy: 文件 ${filename} 已成功写入磁盘, ${bytesWritten} 字节`);
              resolve({
                path: tempFilePath,
                originalname: filename,
                size: bytesWritten,
              });
            });
          });

          writeStream.on('error', (err: Error) => {
            logger.error('Busboy: 写入流错误:', err);
            reject(err);
          });
        });

        bb.on('field', (name, val) => {
          fields[name] = val;
        });

        bb.on('error', (err: Error) => {
          logger.error('Busboy 解析时发生错误:', err);
          reject(err);
        });

        req.pipe(bb);
      });

      fileWritePromise
        .then(fileInfo => {
          logger.info('Busboy: 文件写入Promise成功解决');
          (req as KnowledgeBaseUploadRequest).file = fileInfo;
          req.body = fields;
          next();
        })
        .catch(err => {
          logger.error('Busboy: 文件写入Promise被拒绝:', err);
          return handleKbError(err, res, 'Busboy文件处理');
        });
    },
    async (req: Request, res: Response) => {
      const file = (req as KnowledgeBaseUploadRequest).file;
      // 在try-catch块外部声明tempFilePath，以便在catch中也能访问
      const tempFilePath = file?.path;

      try {
        const { kbId } = req.params;

        const bodyKeys = req.body ? Object.keys(req.body) : ['body is null or undefined'];
        logger.info(
          `Busboy处理完成: kbId=${kbId}, file=${file ? 'exists' : 'missing'}, body=${JSON.stringify(bodyKeys)}`
        );

        if (!file || !tempFilePath) {
          logger.error(`文件上传失败: busboy未接收到文件`);
          return res.status(400).json({ error: '未找到上传的文件' });
        }

        // 修复文件名编码问题
        const originalFileName = file.originalname || 'unknown';
        const correctedFileName = fixFilenameEncoding(originalFileName);

        // 从表单数据中获取模型配置
        const embeddingModelId = req.body.embedding_model_id;
        const pdfOcrModelId = req.body.pdf_ocr_model_id;
        const imageVisionModelId = req.body.image_vision_model_id;
        const legacyVisionModelId = req.body.vision_model_id;
        const rerankModelId = req.body.rerank_model_id;
        const graphExtractionModelId = req.body.graph_extraction_model_id;

        // 🔥 新增：从表单数据中获取PDF解析配置
        const forceVisionMode =
          req.body.force_vision_mode === 'true' || req.body.force_vision_mode === true;

        if (!embeddingModelId) {
          logger.error(`缺少embedding_model_id参数`);
          // 手动触发catch块以进行清理
          throw new Error('缺少必需的 embedding_model_id 参数');
        }

        const fileSize = file.size;

        logger.info(`[KnowledgeBaseRouter] 🔄 调用 KnowledgeBaseService.addDocument()...`);
        logger.info(`[KnowledgeBaseRouter] 📁 临时文件路径: ${tempFilePath}`);
        logger.info(`[KnowledgeBaseRouter] 📏 文件大小: ${fileSize} 字节`);
        logger.info(`[KnowledgeBaseRouter] 🎯 强制视觉模式: ${forceVisionMode}`);

        if (forceVisionMode) {
          await validatePdfOcrUploadPageLimit({
            kbLookup,
            kbId,
            filename: correctedFileName,
            filePath: tempFilePath,
            requestedPdfOcrModelId: pdfOcrModelId,
            documentOcr,
          });
        }

        // 调用服务层添加文档，文件路径被传递，后台服务将负责后续处理
        const result = await kbService.addDocument(
          kbId,
          tempFilePath,
          correctedFileName,
          fileSize,
          embeddingModelId,
          typeof pdfOcrModelId === 'string' && pdfOcrModelId.length > 0 ? pdfOcrModelId : undefined,
          typeof imageVisionModelId === 'string' && imageVisionModelId.length > 0
            ? imageVisionModelId
            : typeof legacyVisionModelId === 'string'
              ? legacyVisionModelId
              : undefined,
          rerankModelId,
          forceVisionMode,
          typeof graphExtractionModelId === 'string' && graphExtractionModelId.length > 0
            ? graphExtractionModelId
            : undefined
        );

        logger.info(`[KnowledgeBaseRouter] ✅ KnowledgeBaseService.addDocument() 返回成功`);
        logger.info(
          `[KnowledgeBaseRouter] 📋 文档上传成功: doc_id=${result.document.id}, task_id=${result.taskId}`
        );
        logger.info(`[KnowledgeBaseRouter] ⚠️ 注意：此时文档可能还在后台处理中...`);

        // 成功后，不删除临时文件，交由后台任务处理
        res.status(201).json({
          document: result.document,
          task_id: result.taskId,
          message: '文档上传成功，正在后台处理',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        // 如果 addDocument 或之前的任何步骤失败，则清理临时文件
        if (tempFilePath) {
          try {
            await fs.unlink(tempFilePath);
            logger.info(`[KnowledgeBaseRouter] 上传失败后成功清理临时文件: ${tempFilePath}`);
          } catch (cleanupError) {
            logger.warn('[KnowledgeBaseRouter] 上传失败后清理临时文件失败:', cleanupError);
          }
        }
        handleKbError(error, res, '上传文档');
      }
    }
  );

  /**
   * 获取知识库中的所有文档
   * @route GET /knowledge-base/:kbId/documents
   */
  router.get('/:kbId/documents', async (req: Request, res: Response) => {
    try {
      const { kbId } = req.params;
      console.log(`[KnowledgeBaseRouter] 获取知识库 ${kbId} 的文档列表`);

      const documents = await kbService.getDocumentsInKnowledgeBase(kbId);

      res.json({
        documents,
        total: documents.length,
        kb_id: kbId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleKbError(error, res, '获取文档列表');
    }
  });

  /**
   * 删除知识库中的文档
   * @route DELETE /knowledge-base/:kbId/documents/:docId
   */
  router.delete('/:kbId/documents/:docId', async (req: Request, res: Response) => {
    try {
      const { kbId, docId } = req.params;
      console.log(`[KnowledgeBaseRouter] 删除文档: kb=${kbId}, doc=${docId}`);

      await kbService.deleteDocument(kbId, docId);

      res.status(204).send();
    } catch (error) {
      handleKbError(error, res, '删除文档');
    }
  });

  /**
   * 继续解析 PDF partial 文档的失败页
   * @route POST /knowledge-base/:kbId/documents/:docId/continue-failed-pages
   */
  router.post(
    '/:kbId/documents/:docId/continue-failed-pages',
    async (req: Request, res: Response) => {
      try {
        const { kbId, docId } = req.params;
        console.log(`[KnowledgeBaseRouter] 继续解析 PDF 失败页: kb=${kbId}, doc=${docId}`);

        const body =
          req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
        const pdfOcrModelId = readAliasedBodyField(body, 'pdfOcrModelId', 'pdf_ocr_model_id');
        const embeddingModelId = readAliasedBodyField(
          body,
          'embeddingModelId',
          'embedding_model_id'
        );

        const result = await kbService.continueFailedPdfPages(kbId, docId, {
          pdfOcrModelId: toNullableModelId(pdfOcrModelId) ?? null,
          embeddingModelId: toNullableModelId(embeddingModelId) ?? null,
        });

        res.json({
          success: true,
          ...result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        handleKbError(error, res, '继续解析 PDF 失败页');
      }
    }
  );

  // ==================== 搜索 API ====================

  /**
   * 在知识库中搜索
   * @route POST /knowledge-base/:kbId/search
   */
  router.post('/:kbId/search', async (req: Request, res: Response) => {
    try {
      const { kbId } = req.params;
      const searchRequest = req.body;

      console.log(`[KnowledgeBaseRouter] 知识库搜索请求: kb=${kbId}`, searchRequest);

      // 将 kbId 添加到搜索请求中
      // 🔥 Phase 2 修复：同时传递 camelCase 的 kbId（TS service 使用）和 snake_case 的 kb_id（兼容旧客户端）
      const searchRequestWithKb = {
        ...searchRequest,
        kbId: kbId, // camelCase - TS KnowledgeBaseCoordinator.search() 使用此字段
        kb_id: kbId, // snake_case - 保持向后兼容
      };

      const searchResult = await kbService.search(searchRequestWithKb);

      res.json({
        ...searchResult,
        kbId: kbId, // camelCase - 新客户端使用
        kb_id: kbId, // snake_case - 向后兼容
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleKbError(error, res, '知识库搜索');
    }
  });

  // ==================== 任务状态查询 API ====================

  /**
   * 获取多个文档的任务状态 (GET 版本 - 用于轮询)
   * @route GET /knowledge-base/tasks/status?id=doc1&id=doc2
   */
  router.get('/tasks/status', async (req: Request, res: Response) => {
    try {
      // 从查询参数中获取文档ID列表
      const docIds = Array.isArray(req.query.id)
        ? (req.query.id as string[])
        : [req.query.id as string];

      if (!docIds || docIds.length === 0 || !docIds[0]) {
        return res.status(400).json({ error: '缺少必需的 id 查询参数' });
      }

      console.log(`[KnowledgeBaseRouter] [GET] 查询任务状态: ${docIds.length} 个文档`);

      const taskStatuses = await kbService.getTasksStatus(docIds);

      res.json({
        task_statuses: taskStatuses,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleKbError(error, res, '查询任务状态');
    }
  });

  /**
   * 取消任务
   * @route POST /knowledge-base/tasks/:taskId/cancel
   */
  router.post('/tasks/:taskId/cancel', async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      console.log(`[KnowledgeBaseRouter] 取消任务: ${taskId}`);

      await kbService.cancelTask(taskId);

      res.json({
        message: '任务取消请求已发送',
        task_id: taskId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleKbError(error, res, '取消任务');
    }
  });

  /**
   * 暂停任务
   * @route POST /knowledge-base/tasks/:taskId/pause
   */
  router.post('/tasks/:taskId/pause', async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      console.log(`[KnowledgeBaseRouter] 暂停任务: ${taskId}`);

      await kbService.pauseTask(taskId);

      res.json({
        message: '任务暂停请求已发送',
        task_id: taskId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleKbError(error, res, '暂停任务');
    }
  });

  /**
   * 恢复任务
   * @route POST /knowledge-base/tasks/:taskId/resume
   */
  router.post('/tasks/:taskId/resume', async (req: Request, res: Response) => {
    try {
      const { taskId } = req.params;
      console.log(`[KnowledgeBaseRouter] 恢复任务: ${taskId}`);

      await kbService.resumeTask(taskId);

      res.json({
        message: '任务恢复请求已发送',
        task_id: taskId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleKbError(error, res, '恢复任务');
    }
  });

  /**
   * 获取多个文档的任务状态 (POST 版本 - 兼容性)
   * @route POST /knowledge-base/tasks/status
   */
  router.post('/tasks/status', async (req: Request, res: Response) => {
    try {
      const { doc_ids } = req.body;

      if (!Array.isArray(doc_ids)) {
        return res.status(400).json({ error: 'doc_ids 必须是数组格式' });
      }

      console.log(`[KnowledgeBaseRouter] [POST] 查询任务状态: ${doc_ids.length} 个文档`);

      const taskStatuses = await kbService.getTasksStatus(doc_ids);

      res.json({
        task_statuses: taskStatuses,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      handleKbError(error, res, '查询任务状态');
    }
  });

  /**
   * 读取 Citation Snapshot Bundle（按 bundle_id）
   *
   * @route GET /knowledge-base/citation-snapshots/bundles/:bundleId
   */
  router.get('/citation-snapshots/bundles/:bundleId', async (req: Request, res: Response) => {
    try {
      const bundleId = typeof req.params.bundleId === 'string' ? req.params.bundleId.trim() : '';
      if (!bundleId) {
        return res.status(400).json({ error: 'bundleId 不能为空' });
      }

      const conversationId =
        typeof req.query.conversation_id === 'string' ? req.query.conversation_id.trim() : '';
      if (!conversationId) {
        return res
          .status(400)
          .json({
            error: 'conversation_id 不能为空（CitationSnapshotStore 已收口到 conversation-root）',
          });
      }
      const instanceId =
        typeof req.query.instance_id === 'string' ? req.query.instance_id.trim() : undefined;

      const record = await readHistoricalCitationSnapshotBundle({
        conversationId,
        instanceId,
        bundleId,
      });

      const shouldDownload = req.query.download === '1' || req.query.download === 'true';
      if (shouldDownload) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="citation_snapshot_${bundleId}.json"`
        );
        return res.status(200).send(JSON.stringify(record));
      }

      return res.json(record);
    } catch (error) {
      handleKbError(error, res, '读取 Citation Snapshot Bundle');
    }
  });

  return router;
}
