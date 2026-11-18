import { parsePluginDocument } from '@plugin/backend/documentParsingRuntime';
/**
 * @file packages/plugins/knowledge/src/backend/ingestion/handlers/ParsingHandler.ts
 *
 * @brief PARSING状态处理器
 *
 * @description
 * 功能 (What): 处理文档解析阶段的业务逻辑
 * 输入 (Input): TaskContext包含文件路径和解析参数
 * 输出 (Output): StateTransitionResult，包含解析结果
 * 副作用 (Side-effects): 读取文件，调用解析器，生成结构化内容
 */

import { Logger } from '@plugin/backend/loggingRuntime';
import {
  InternalStage,
  type StateHandler,
  type StateTransitionResult,
  type TaskContext,
} from '../definitions/state';
import path from 'path';
import { promises as fs } from 'fs';
import { postProcessBlocks, type RawBlock } from '../postprocessor'; // 导入后处理函数
import type { ParseResult } from '../ingestionTypes';
import type { TextGenerationPort } from '@plugin/backend/inferenceRuntime';
import type { DocumentOcrPort } from '@plugin/backend/inferenceRuntime';
import { isRecord } from '@linnya/foundation';

const logger = new Logger('knowledge-base:ingestion:parsing-handler');

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
  private updateProgress(context: TaskContext, stageProgress: number, _message?: string): void {
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
      const fileExtension = path.extname(context.filename).toLowerCase();

      // 降噪：移除详细文件信息的debug日志

      // 🔥 更新进度：文件已读取，使用标准状态消息
      this.updateProgress(context, 10, '解析中');

      if (!context.ocrTemporaryDirectory) {
        throw new Error('摄入任务缺少已准入的解析素材目录');
      }
      // 模型和目录在入队时冻结；解析器仅调用 Host 推理能力，不读取目录或凭据。
      const parsed = await parsePluginDocument(
        {
          bytes: fileBuffer,
          documentId: context.docId,
          filename: context.filename,
          pdfOcrModelId: context.pdfOcrModelId,
          imageVisionModelId: context.imageVisionModelId ?? context.visionModelId,
          forceVisionMode: context.forceVisionMode,
          temporaryDirectory: context.ocrTemporaryDirectory,
          signal: context.signal,
          onProgress: progress => this.updateProgress(context, 10 + progress * 0.8, '解析中'),
        },
        { textGeneration: this.textGeneration, documentOcr: this.documentOcr }
      );
      const parsedBlocks = parsed.blocks;
      const parseDiagnostics = parsed.diagnostics;

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
          parser: parsed.parser,
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
