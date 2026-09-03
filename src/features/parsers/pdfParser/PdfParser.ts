/**
 * @file src/parsers/pdfParser/PdfParser.ts
 *
 * **功能 (What):** 智能PDF文档解析器主类，协调三层处理策略
 * **输入 (Input):** PDF二进制数据和配置选项
 * **输出 (Output):** 解析后的ParsedBlock数组
 * **副作用 (Side-effects):** 协调各个模块进行PDF处理
 */

import { Parser, ParsedBlock, ProgressUpdater } from '../types';
import { PdfParserOptions } from './types';
import type { TextGenerationPort } from 'src/domains/model-inference';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import { tryQuickTextExtraction } from './strategies/TextExtractionStrategy';
import { tryGeometricExtraction } from './strategies/GeometricAnalysisStrategy';
import { processWithVisionDiagnostics } from './strategies/VisionRecognitionStrategy';
import { Logger } from '../../../shared/logger';
import { resolveModelIdFromPolicy } from 'src/app-hosts/linnya/agent-registry/modelPolicyResolver';
import {
  PDF_OCR_DEFAULT_FALLBACK_MODEL_ID,
  PDF_OCR_MODEL_POLICY,
} from 'src/app-hosts/linnya/agent-registry/internals/ingestion/pdf_ocr';
import { getPdfPageCountCrossPlatform } from './adapters/PdfParseAdapter';
import type { PdfParseOutcome } from './definitions/pdfParseOutcome';
import { createPdfParseDiagnostics } from './definitions/pdfParseOutcome';

const logger = new Logger('PdfParser');

/**
 * **功能 (What):** 智能PDF文件解析器类，采用分层处理策略
 * **输入 (Input):** 实现 Parser 接口，支持多种处理策略
 * **输出 (Output):** 提供 parse 方法来解析 PDF 文件
 * **副作用 (Side-effects):**
 * 1. 可能创建临时文件用于图像转换
 * 2. 调用不同的PDF处理库
 * 3. 可能使用AI引擎进行图像识别
 */
export class PdfParser implements Parser {
  private options: {
    textGeneration: TextGenerationPort | null;
    documentOcr: DocumentOcrPort | null;
    filename?: string;
    visionModelId: string;
    resolveModelByCapability?: (capability: string) => string | undefined;
    targetPixels: number;
    tpmLimitPerWorker: number;
    maxRetries: number;
    useSystemTools: boolean;
    forceVisionMode: boolean;
  };

  /**
   * **功能 (What):** 构造PDF解析器实例
   * **输入 (Input / @param):**
   * @param options - PDF解析器配置选项
   * **输出 (Output):** PDF解析器实例
   * **副作用 (Side-effects):** 初始化解析器配置
   */
  constructor(options: PdfParserOptions = {}) {
    this.options = {
      textGeneration: options.textGeneration ?? null,
      documentOcr: options.documentOcr ?? null,
      filename: options.filename,
      visionModelId: options.visionModelId || '',
      resolveModelByCapability: options.resolveModelByCapability,
      targetPixels: options.targetPixels || 2048,
      tpmLimitPerWorker: options.tpmLimitPerWorker || 20,
      maxRetries: options.maxRetries || 5,
      useSystemTools: options.useSystemTools ?? false,
      forceVisionMode: options.forceVisionMode ?? false,
    };
  }

  /**
   * **功能 (What):** 解析PDF文件内容，使用智能分层策略
   * **输入 (Input / @param):**
   * @param data - 文件内容的 Uint8Array
   * @param docId - 文档的唯一ID
   * @param updater - 进度更新器（可选）
   * **输出 (Output / @returns):** 解析后的 ParsedBlock 数组
   * **副作用 (Side-effects):**
   * 1. 尝试多种PDF处理策略
   * 2. 可能创建临时文件
   * 3. 可能调用AI引擎
   */
  async parse(data: Uint8Array, docId: string, updater?: ProgressUpdater): Promise<ParsedBlock[]> {
    const outcome = await this.parseWithDiagnostics(data, docId, updater);
    return outcome.blocks;
  }

  async parseWithDiagnostics(
    data: Uint8Array,
    docId: string,
    updater?: ProgressUpdater
  ): Promise<PdfParseOutcome> {
    if (updater) {
      updater(0, '开始解析PDF文件...');
    }

    logger.info(`开始智能解析PDF文档: ${docId}`);

    try {
      // 🔥 新增：强制视觉模式判断 - 如果启用，直接跳过Layer 1和Layer 2
      if (this.options.forceVisionMode) {
        logger.info(`[强制视觉模式] 跳过传统解析策略，直接使用AI视觉识别`);
        if (updater) updater(5, '使用AI视觉识别模式解析...');

        // 直接进入Layer 3: AI视觉识别
        const visionResult = await this.tryVisionExtractionWithDiagnostics(data, docId, updater, 5);
        if (visionResult.success) {
          logger.info(`[强制视觉模式] AI视觉识别成功，共 ${visionResult.blocks.length} 个块`);
          if (updater) {
            updater(90, 'AI识别完成，正在整理结果...');
            // 短暂延迟后报告完成
            await new Promise(resolve => setTimeout(resolve, 50));
            updater(100, `解析完成，共生成 ${visionResult.blocks.length} 个块`);
          }
          return {
            blocks: visionResult.blocks,
            diagnostics: visionResult.diagnostics,
          };
        } else {
          logger.error(`[强制视觉模式] AI视觉识别失败: ${visionResult.error}`);
          throw new Error(visionResult.error || '强制视觉模式解析失败');
        }
      }

      // 执行完整的3层解析策略，无论是否在Worker线程中
      logger.info(`执行完整的3层解析策略`);

      const strategyResult = await tryQuickTextExtraction(data, docId);
      if (strategyResult.success) {
        const blocks = strategyResult.blocks ?? [];
        const totalPages = await getPdfPageCountCrossPlatform(data);
        logger.info(`Layer 1 (快速文本提取) 成功，共 ${blocks.length} 个块`);
        if (updater) updater(100, `文本提取完成，共生成 ${blocks.length} 个块`);
        return {
          blocks,
          diagnostics: createPdfParseDiagnostics({
            pipeline: 'text_extraction',
            totalPages,
            blocks,
          }),
        };
      }

      logger.warn(`Layer 1 失败: ${strategyResult.error}，尝试 Layer 2...`);
      if (updater) updater(2, '尝试几何分析解析...');

      // 🔥 记录Layer 2的最高进度，用于Layer 3继承
      let layer2MaxProgress = 2; // Layer 2的起始进度
      const progressTrackingUpdater = updater
        ? (progress: number, message: string) => {
            layer2MaxProgress = Math.max(layer2MaxProgress, progress);
            updater(progress, message);
          }
        : undefined;

      // Layer 2: 几何分析
      const geometryResult = await tryGeometricExtraction(data, docId, progressTrackingUpdater);
      if (geometryResult.success) {
        const blocks = geometryResult.blocks ?? [];
        const totalPages = await getPdfPageCountCrossPlatform(data);
        logger.info(`Layer 2 (几何分析) 成功，共 ${blocks.length} 个块`);
        if (updater) updater(100, `几何分析完成，共生成 ${blocks.length} 个块`);
        return {
          blocks,
          diagnostics: createPdfParseDiagnostics({
            pipeline: 'geometric_analysis',
            totalPages,
            blocks,
          }),
        };
      }

      logger.warn(`Layer 2 失败: ${geometryResult.error}，尝试 Layer 3...`);

      // 🔥 修复：Layer 3 继承 Layer 2 的最高进度作为起点，避免进度回退
      const layer3StartProgress = Math.max(layer2MaxProgress, 5); // 至少从5%开始，但不低于Layer 2已达到的进度
      if (updater) updater(layer3StartProgress, '开始AI视觉识别...');

      // Layer 3: AI视觉识别 - 传递起始进度
      const visionResult = await this.tryVisionExtractionWithDiagnostics(
        data,
        docId,
        updater,
        layer3StartProgress
      );
      if (visionResult.success) {
        logger.info(`Layer 3 (AI视觉识别) 成功，共 ${visionResult.blocks.length} 个块`);
        if (updater) {
          updater(90, 'AI识别完成，正在整理结果...');
          // 短暂延迟后报告完成
          await new Promise(resolve => setTimeout(resolve, 50));
          updater(100, `解析完成，共生成 ${visionResult.blocks.length} 个块`);
        }
        return {
          blocks: visionResult.blocks,
          diagnostics: visionResult.diagnostics,
        };
      }

      logger.error(`所有解析策略失败: ${visionResult.error}`);
      throw new Error(visionResult.error || '所有解析策略失败');
    } catch (error) {
      const errorMessage = `PDF解析失败: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`${errorMessage}`, error);
      throw new Error(errorMessage);
    }
  }

  private async tryVisionExtractionWithDiagnostics(
    data: Uint8Array,
    docId: string,
    updater?: ProgressUpdater,
    startProgress: number = 5
  ): Promise<
    | { success: true; blocks: ParsedBlock[]; diagnostics: PdfParseOutcome['diagnostics'] }
    | { success: false; error: string }
  > {
    try {
      const textGeneration = this.options.textGeneration;
      const documentOcr = this.options.documentOcr;
      let visionModelId = this.options.visionModelId;

      if (!textGeneration) {
        return {
          success: false,
          error: 'PDF Layer 3 AI视觉识别失败：未配置 textGeneration 端口',
        };
      }
      if (!documentOcr) {
        return {
          success: false,
          error: 'PDF Layer 3 AI视觉识别失败：未配置 documentOcr 端口',
        };
      }
      if (!visionModelId) {
        visionModelId =
          resolveModelIdFromPolicy(PDF_OCR_MODEL_POLICY, {
            kbVisionModelId: this.options.visionModelId,
            defaultVisionModelId: PDF_OCR_DEFAULT_FALLBACK_MODEL_ID,
            resolveByCapability: this.options.resolveModelByCapability,
          }) ?? PDF_OCR_DEFAULT_FALLBACK_MODEL_ID;
        logger.info(`使用默认视觉模型: ${visionModelId}`);
      }

      // 创建支持起始进度的updater包装器
      const progressAwareUpdater = updater
        ? (progress: number, message: string) => {
            // 将Vision策略内部的 5-90% 映射到 startProgress-90% 区间
            const mappedProgress = startProgress + ((progress - 5) / 85) * (90 - startProgress);
            updater(Math.max(startProgress, mappedProgress), message);
          }
        : undefined;

      const visionResult = await processWithVisionDiagnostics(
        data,
        docId,
        textGeneration,
        documentOcr,
        visionModelId,
        {
          filename: this.options.filename,
          targetPixels: this.options.targetPixels || 2048,
          maxRetries: this.options.maxRetries || 3,
          tpmLimitPerWorker: this.options.tpmLimitPerWorker || 20,
        },
        progressAwareUpdater
      );

      return visionResult;
    } catch (error) {
      return {
        success: false,
        error: `AI视觉识别过程失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * **功能 (What):** 获取解析器配置信息
   * **输入 (Input):** 无
   * **输出 (Output / @returns):** 配置信息对象
   * **副作用 (Side-effects):** 无副作用，纯信息获取
   */
  getConfiguration(): {
    hasTextGeneration: boolean;
    hasVisionModel: boolean;
    targetPixels: number;
    maxRetries: number;
    useSystemTools: boolean;
    forceVisionMode: boolean;
    supportedStrategies: string[];
  } {
    const strategies: string[] = ['text_extraction'];

    // 总是支持几何分析（使用pdfjs-dist）
    strategies.push('geometric_analysis');

    // 只有在显式配置文本生成端口时才支持视觉识别。
    if (this.options.textGeneration && this.options.visionModelId) {
      strategies.push('vision_recognition');
    }

    return {
      hasTextGeneration: !!this.options.textGeneration,
      hasVisionModel: !!this.options.visionModelId,
      targetPixels: this.options.targetPixels,
      maxRetries: this.options.maxRetries,
      useSystemTools: this.options.useSystemTools,
      forceVisionMode: this.options.forceVisionMode,
      supportedStrategies: strategies,
    };
  }

  /**
   * **功能 (What):** 检测PDF文档类型和复杂度
   * **输入 (Input / @param):**
   * @param data - PDF文件二进制数据
   * **输出 (Output / @returns):** 文档类型和推荐策略
   * **副作用 (Side-effects):** 分析PDF结构，无修改操作
   */
  async analyzeDocument(data: Uint8Array): Promise<{
    documentType: 'simple' | 'multi_column' | 'complex' | 'scanned';
    recommendedStrategy: 'text_extraction' | 'geometric_analysis' | 'vision_recognition';
    confidence: number;
    analysis: {
      pageCount: number;
      textDensity: number;
      hasStructure: boolean;
      estimatedColumns: number;
    };
  }> {
    try {
      // 先尝试快速分析
      const quickResult = await tryQuickTextExtraction(data, 'temp-analysis-id');

      if (quickResult.success) {
        // 简单文档，直接文本提取即可
        return {
          documentType: 'simple',
          recommendedStrategy: 'text_extraction',
          confidence: 0.9,
          analysis: {
            pageCount: 1, // 这里简化，实际应该获取真实页数
            textDensity: quickResult.blocks!.length * 100, // 简化计算
            hasStructure: true,
            estimatedColumns: 1,
          },
        };
      } else {
        // 需要更复杂的处理
        if (quickResult.error?.includes('多栏')) {
          return {
            documentType: 'multi_column',
            recommendedStrategy: 'geometric_analysis',
            confidence: 0.7,
            analysis: {
              pageCount: 1,
              textDensity: 0,
              hasStructure: false,
              estimatedColumns: 2,
            },
          };
        } else if (quickResult.error?.includes('扫描')) {
          return {
            documentType: 'scanned',
            recommendedStrategy: 'vision_recognition',
            confidence: 0.8,
            analysis: {
              pageCount: 1,
              textDensity: 0,
              hasStructure: false,
              estimatedColumns: 0,
            },
          };
        } else {
          return {
            documentType: 'complex',
            recommendedStrategy: 'vision_recognition',
            confidence: 0.6,
            analysis: {
              pageCount: 1,
              textDensity: 0,
              hasStructure: false,
              estimatedColumns: 0,
            },
          };
        }
      }
    } catch (error) {
      // 分析失败，默认推荐视觉识别
      return {
        documentType: 'complex',
        recommendedStrategy: 'vision_recognition',
        confidence: 0.3,
        analysis: {
          pageCount: 0,
          textDensity: 0,
          hasStructure: false,
          estimatedColumns: 0,
        },
      };
    }
  }
}
