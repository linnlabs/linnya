/**
 * @file src/knowledge-base/ingestion/handlers/ParsingHandler.ts
 *
 * @brief PARSING状态处理器
 *
 * @description
 * 功能 (What): 处理文档解析阶段的业务逻辑
 * 输入 (Input): TaskContext包含文件路径和解析参数
 * 输出 (Output): StateTransitionResult，包含解析结果
 * 副作用 (Side-effects): 读取文件，调用解析器，生成结构化内容
 */

import { Logger } from 'src/shared/logger';
import {
  InternalStage,
  type StateHandler,
  type StateTransitionResult,
  type TaskContext,
} from '../definitions/state';
import path from 'path';
import { promises as fs } from 'fs';
import { getParser } from 'src/features/parsers/index'; // 导入统一的解析器工厂函数
import type { Parser } from 'src/features/parsers/types';
import {
  createSmartPdfParser,
  createVisionPdfParser,
} from 'src/features/parsers/pdfParser/factory'; // PDF 解析器工厂
import { parseImageWithAi } from 'src/features/parsers/imageParser';
import { postProcessBlocks, type RawBlock } from '../postprocessor'; // 导入后处理函数
import { inspect } from 'util'; // 导入inspect
import type { ParseResult } from '../ingestionTypes';
import type { TextGenerationPort } from 'src/domains/model-inference';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import { resolveModelIdFromPolicy } from 'src/app-hosts/linnya/agent-registry/modelPolicyResolver';
import { IMAGE_DESCRIPTION_MODEL_POLICY } from 'src/app-hosts/linnya/agent-registry/internals/ingestion/image_description';
import {
  PDF_OCR_DEFAULT_FALLBACK_MODEL_ID,
  PDF_OCR_MODEL_POLICY,
} from 'src/app-hosts/linnya/agent-registry/internals/ingestion/pdf_ocr';
import type { DocumentParseDiagnostics } from '../../domain/document';
import type { PdfParser } from 'src/features/parsers/pdfParser/PdfParser';
import { getDefaultModelIdByCapability } from 'src/domains/model-catalog';

const logger = new Logger('knowledge-base:ingestion:parsing-handler');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function isRawSourceInfo(value: unknown): value is NonNullable<RawBlock['source_info']> {
  if (!isRecord(value)) {
    return false;
  }

  const pageNumber = value['page_number'];
  const location = value['location'];
  return (
    (pageNumber === undefined || typeof pageNumber === 'number') &&
    (location === undefined || typeof location === 'string')
  );
}

/**
 * 功能 (What): PARSING状态处理器 - 文档解析核心逻辑
 * 输入 (Input): 任务上下文
 * 输出 (Output): 转换到EMBEDDING状态，包含解析结果
 * 副作用 (Side-effects): 读取文件，解析文档内容，生成结构化块，实时更新进度
 */
export class ParsingHandler implements StateHandler {
  // 🔥 新增：进度更新回调函数
  private progressCallback?: (context: TaskContext) => void;
  private readonly textGeneration: TextGenerationPort;
  private readonly documentOcr: DocumentOcrPort;

  constructor(
    textGeneration: TextGenerationPort,
    documentOcr: DocumentOcrPort,
    progressCallback?: (context: TaskContext) => void
  ) {
    this.textGeneration = textGeneration;
    this.documentOcr = documentOcr;
    this.progressCallback = progressCallback;
  }

  getName(): string {
    return 'ParsingHandler';
  }

  /**
   * 🔥 新增：内部进度更新方法，统一处理进度更新和通知
   */
  private updateProgress(context: TaskContext, stageProgress: number, message?: string): void {
    context.stageProgress = Math.max(0, Math.min(100, stageProgress));
    context.lastUpdated = Date.now();

    // 降噪：不再记录每次进度的debug日志
    if (this.progressCallback) {
      this.progressCallback(context);
    }
  }

  async execute(context: TaskContext): Promise<StateTransitionResult> {
    logger.info(`[ParsingHandler] 开始解析文档: ${context.filename}`);

    try {
      // 🔥 更新进度：开始解析，使用标准状态消息
      this.updateProgress(context, 5, '解析中');

      // 步骤 1: 读取文件内容
      // 文件路径验证完成

      // 验证文件路径的存在性
      const fileExists = await fs
        .access(context.filePath)
        .then(() => true)
        .catch(() => false);
      if (!fileExists) {
        throw new Error(`文件不存在: ${context.filePath}`);
      }

      const fileBuffer = await this.readFile(context.filePath);
      const fileStats = await fs.stat(context.filePath);
      const fileExtension = path.extname(context.filename).toLowerCase();

      // 降噪：移除详细文件信息的debug日志

      // 🔥 更新进度：文件已读取，使用标准状态消息
      this.updateProgress(context, 10, '解析中');

      // 🔥 智能解析器选择：PDF / 图片都必须显式使用当前知识库的模型配置，不能回落到全局默认值
      let parser: Parser | null;
      let pdfParser: PdfParser | null = null;
      if (fileExtension === '.pdf') {
        // PDF 文件：无论是否强制视觉模式，都要把当前知识库的 PDF OCR 模型显式传给解析器。
        logger.info(
          `[ParsingHandler] 为 PDF 创建知识库定制解析器: ${context.filename}, forceVisionMode=${context.forceVisionMode === true}`
        );
        const visionModelId =
          resolveModelIdFromPolicy(PDF_OCR_MODEL_POLICY, {
            kbPdfOcrModelId: context.pdfOcrModelId,
            kbVisionModelId: context.visionModelId,
            defaultVisionModelId: PDF_OCR_DEFAULT_FALLBACK_MODEL_ID,
            resolveByCapability: getDefaultModelIdByCapability,
          }) ?? PDF_OCR_DEFAULT_FALLBACK_MODEL_ID;

        pdfParser = context.forceVisionMode
          ? createVisionPdfParser(this.textGeneration, visionModelId, {
              documentOcr: this.documentOcr,
              filename: context.filename,
              forceVisionMode: true,
              maxRetries: 5,
              resolveModelByCapability: getDefaultModelIdByCapability,
            })
          : createSmartPdfParser(this.textGeneration, visionModelId, {
              documentOcr: this.documentOcr,
              filename: context.filename,
              forceVisionMode: false,
              maxRetries: 5,
              resolveModelByCapability: getDefaultModelIdByCapability,
            });
        parser = pdfParser;
      } else {
        // 其他文件类型或未启用强制视觉模式：使用默认解析器
        parser = getParser(fileExtension);
      }

      if (!parser) {
        throw new Error(`不支持的文件类型: ${fileExtension}`);
      }

      // 降噪：移除解析器名称的debug日志

      // 🔥 创建解析进度回调，支持细粒度更新
      const parseProgressCallback = (progress: number, message: string) => {
        // 解析阶段占整个PARSING阶段的80% (10% -> 90%)
        const stageProgress = 10 + progress * 0.8;
        this.updateProgress(context, stageProgress, '解析中');
      };

      //  修复：确保传递正确的数据类型给解析器（零拷贝视图）
      const uint8ArrayData = new Uint8Array(
        fileBuffer.buffer,
        fileBuffer.byteOffset,
        fileBuffer.byteLength
      );

      let parseDiagnostics: DocumentParseDiagnostics | undefined;

      const parsedBlocks = await (async () => {
        // ✅ 根因修复：图片解析必须使用 KB 的图片视觉模型，不能与 PDF OCR 共用一个字段
        if (['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'].includes(fileExtension)) {
          const visionModelId = resolveModelIdFromPolicy(IMAGE_DESCRIPTION_MODEL_POLICY, {
            kbImageVisionModelId: context.imageVisionModelId,
            kbVisionModelId: context.visionModelId,
          });
          if (!visionModelId) {
            throw new Error('缺少图片视觉模型，无法解析图片文档');
          }
          return await parseImageWithAi(
            uint8ArrayData,
            context.docId,
            this.textGeneration,
            visionModelId,
            (p, msg) => parseProgressCallback(p, msg)
          );
        }

        if (fileExtension === '.pdf' && pdfParser) {
          const outcome = await pdfParser.parseWithDiagnostics(
            uint8ArrayData,
            context.docId,
            parseProgressCallback
          );
          parseDiagnostics = outcome.diagnostics;
          return outcome.blocks;
        }

        return await parser.parse(uint8ArrayData, context.docId, parseProgressCallback);
      })();

      // 步骤 3: 验证解析结果
      if (!parsedBlocks || parsedBlocks.length === 0) {
        logger.warn(`[ParsingHandler] 文档解析后无内容: ${context.filename}`);

        const errorMessage = '文档解析完成但无可提取内容，可能是扫描件或格式不支持';
        return {
          success: false,
          newStage: InternalStage.FAILED,
          context: { ...context, errorMessage },
          error: errorMessage,
        };
      }

      // 🔥 更新进度：开始后处理，使用标准状态消息
      this.updateProgress(context, 90, '解析中');

      // 步骤 4: 进行后处理，优化内容块
      // 降噪：移除后处理debug日志

      // 规范化块类型: 将 heading1/2/3 转换为统一的 heading 并提取层级
      const rawBlocks: RawBlock[] = parsedBlocks.map(block => {
        const metadata = block.metadata ?? {};
        let headingLevel = readOptionalNumber(metadata, 'heading_level');

        const headingMatch = /^heading(\d+)$/i.exec(block.type);
        if (headingMatch) {
          headingLevel = parseInt(headingMatch[1], 10);
        }

        const metadataSourceInfo = metadata['source_info'];
        const sourceInfo = isRawSourceInfo(block.source_info)
          ? block.source_info
          : isRawSourceInfo(metadataSourceInfo)
            ? metadataSourceInfo
            : {};

        return {
          id: block.blockId,
          text: block.text,
          type: block.type,
          heading_level: headingLevel,
          heading_path: metadata['heading_path'],
          // ⚠️ 关键修复: 直接使用解析器提供的 source_info（包含 page_number 等关键信息）
          source_info: sourceInfo,
          // 保留原始 metadata 以备后续处理器使用
          metadata,
        };
      });

      // 调用后处理函数
      const postProcessResult = await postProcessBlocks({
        rawBlocks,
        sourceFilePath: context.filePath,
        docId: context.docId,
        originalFilename: context.filename,
      });

      // 🔥 更新进度：后处理完成，使用标准状态消息
      this.updateProgress(context, 100, '解析中');

      // 准备向量化阶段的数据
      const parseResultWithMetadata: ParseResult = {
        contentBlocks: postProcessResult.processedBlocks,
        sourceDoc: postProcessResult.sourceDoc,
        metadata: {
          fileType: fileExtension,
          totalBlocks: postProcessResult.processedBlocks.length,
          parser: parser.constructor.name,
          postProcessed: true,
          ...(parseDiagnostics ? { parseDiagnostics } : {}),
        },
      };

      logger.info(
        `[ParsingHandler] 后处理完成: ${postProcessResult.processedBlocks.length} 个优化内容块`
      );

      return {
        success: true,
        newStage: InternalStage.EMBEDDING,
        context: {
          ...context,
          parseResult: parseResultWithMetadata,
          stageProgress: 100, // PARSING阶段100%完成
        },
        message: `文档解析与后处理完成，生成 ${postProcessResult.processedBlocks.length} 个优化内容块`,
      };
    } catch (error) {
      const errorMessage = `文档解析失败: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[ParsingHandler] ${errorMessage}`, error);

      return {
        success: false,
        newStage: InternalStage.FAILED,
        context: { ...context, errorMessage },
        error: errorMessage,
      };
    }
  }

  /**
   * 功能 (What): 读取文件内容
   * 输入 (Input): 文件路径
   * 输出 (Output): 文件内容Buffer
   * 副作用 (Side-effects): 访问文件系统
   */
  private async readFile(filePath: string): Promise<Buffer> {
    try {
      // 降噪：移除详细路径与文件大小的debug日志
      const resolvedPath = path.resolve(filePath);
      const buffer = await fs.readFile(resolvedPath);
      return buffer;
    } catch (error) {
      const errorMessage = `读取文件失败: ${filePath} - ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[ParsingHandler] ${errorMessage}`);
      throw new Error(errorMessage);
    }
  }
}
