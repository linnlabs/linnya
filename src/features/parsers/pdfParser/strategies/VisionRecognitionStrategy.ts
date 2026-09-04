/**
 * @file src/parsers/pdfParser/strategies/VisionRecognitionStrategy.ts
 *
 * **功能 (What):** Layer 3 - AI视觉识别策略，处理复杂和扫描PDF
 * **输入 (Input):** PDF二进制数据、文本生成端口和视觉模型
 * **输出 (Output):** 处理结果
 * **副作用 (Side-effects):** 创建临时文件，调用文本生成端口，使用图像处理库
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { pathManager } from '../../../../shared/utils/pathManager';

import { StrategyResult } from '../types';
import type { TextGenerationPort } from 'src/domains/model-inference';
import type {
  DocumentOcrModelProfile,
  DocumentOcrPort,
  OcrDocumentPage,
} from 'src/domains/document-ocr';
import { getPdfPageCountCrossPlatform } from '../adapters/PdfParseAdapter';
import {
  openPdfRasterDocumentFromBytes,
  openPdfRasterDocumentFromPath,
} from '../adapters/PdfRasterAdapter';
import {
  PDF_RASTER_DEFAULT_TARGET_PIXELS,
  PDF_VISION_MAX_IN_FLIGHT_PAGES,
  type PdfRasterDocument,
  normalizePdfRasterTargetPixels,
} from '../definitions/pdfRaster';
import { parseMarkdownToBlocks } from '../utils/dataConverters';
import {
  calculateVisionTokensForOurImages,
  estimateTextTokens,
} from '../../../../shared/utils/tokenUtils';
import pdfOcrPrompt from 'src/app-hosts/linnya/agent-registry/internals/ingestion/pdf_ocr';
import type { ParsedBlock } from '../../types';
import { classifyOcrError, type OcrErrorClassification } from '../functions/errorClassification';
import { EmptyOcrContentError, OcrTimeoutError } from '../definitions/ocrErrors';
import type {
  PdfParseDiagnostics,
  PdfPageDiagnostic,
  PdfParsePipeline,
} from '../definitions/pdfParseOutcome';
import { createPdfParseDiagnostics } from '../definitions/pdfParseOutcome';
import { assertDocumentOcrPageLimit } from 'src/domains/document-ocr';

/**
 * 每页 block id 生成时预留的索引跨度。
 *
 * 为什么是 10000：
 * - parseMarkdownToBlocks 内部按 block 顺序生成确定性 UUIDv5；
 * - 视觉路径逐页调用它，必须给不同页分配互不重叠的 index 区间；
 * - 单页 OCR 产出超过 10000 个块不属于当前真实业务场景，若未来要支持，应先重审 block id 方案。
 */
const PAGE_BLOCK_INDEX_STRIDE = 10000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 视觉识别“单次尝试”的硬超时。
 *
 * 设计说明（根因）：
 * - 之前在 `processWithVision` 外层用 `Promise.race(..., 120s)` 做超时，
 *   会导致“超时异常”绕过 `recognizeImageContent` 的重试逻辑，从而出现“失败就直接下一页”。
 * - 现在把超时下沉到 `recognizeImageContent` 的每次 attempt：
 *   - 超时会触发重试（指数退避）；
 *   - 对支持 AbortSignal 的 provider（如 PaddleOCR）会主动中断底层 HTTP 请求，避免悬挂。
 */
const AI_RECOGNITION_ATTEMPT_TIMEOUT_DEFAULT_MS = 120_000;

class OcrRetryExhaustedError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'OcrRetryExhaustedError';
    this.cause = cause;
  }
}

export function getAiRecognitionAttemptTimeoutMs(profile?: DocumentOcrModelProfile): number {
  return profile?.attemptTimeoutMs ?? AI_RECOGNITION_ATTEMPT_TIMEOUT_DEFAULT_MS;
}

function createRetryExhaustedError(args: {
  scope: string;
  maxRetries: number;
  cause: unknown;
}): OcrRetryExhaustedError {
  const message = args.cause instanceof Error ? args.cause.message : String(args.cause);
  return new OcrRetryExhaustedError(
    `${args.scope} 重试 ${args.maxRetries} 次后仍失败: ${message}`,
    args.cause
  );
}

function readRetryDelayMs(
  error: unknown,
  classification: OcrErrorClassification,
  attempt: number
): number {
  if (isRecord(error)) {
    const retryAfterMs = error.retryAfterMs;
    if (typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
      return Math.min(retryAfterMs, 120_000);
    }
  }

  const baseDelayMs =
    classification.kind === 'rate_limited'
      ? 5_000
      : classification.kind === 'timeout'
        ? 3_000
        : 1_000;
  const maxDelayMs = classification.kind === 'rate_limited' ? 120_000 : 30_000;
  return Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
}

function shouldRetryOcrAttempt(args: {
  attempt: number;
  maxRetries: number;
  classification: OcrErrorClassification;
}): boolean {
  return args.attempt < args.maxRetries && args.classification.retryable;
}

async function waitBeforeRetry(args: {
  scope: string;
  attempt: number;
  delayMs: number;
  classification: OcrErrorClassification;
}): Promise<void> {
  console.log(
    `[VisionRecognitionStrategy] ${args.scope} 将因 ${args.classification.kind} 重试第 ${args.attempt} 次，等待 ${args.delayMs / 1000}s`
  );
  await new Promise(resolve => setTimeout(resolve, args.delayMs));
}

function describeOcrFailureForUser(error: unknown): string {
  const classification = classifyOcrError(error);
  const detail = error instanceof Error ? error.message : String(error);

  switch (classification.kind) {
    case 'auth':
      return `OCR 模型认证失败，请检查 API key、额度权限或模型访问权限。${detail}`;
    case 'rate_limited':
      return `OCR 服务触发限流，请稍后重试或降低同时解析任务数量。${detail}`;
    case 'timeout':
      return `OCR 服务响应超时，请稍后重试；如果多次发生，建议降低并发或改用更稳定的 OCR 模型。${detail}`;
    case 'payload_too_large':
      return `OCR 输入超过上游限制，请拆分 PDF 后重试。${detail}`;
    case 'bad_request':
      return `OCR 请求参数或文件格式被上游拒绝，请检查模型配置与文件内容。${detail}`;
    case 'server':
      return `OCR 服务端异常，请稍后重试。${detail}`;
    case 'network':
      return `OCR 网络请求失败，请检查网络连接或代理配置。${detail}`;
    case 'empty_content':
      return `OCR 未返回可用文本内容。${detail}`;
    case 'local_conversion':
      return `PDF 本地转图失败，请检查 PDF 是否损坏或系统 PDF 工具是否可用。${detail}`;
    case 'unknown':
      return detail;
  }
}

function describePageDiagnosticForUser(item: PdfPageDiagnostic): string {
  switch (item.errorKind) {
    case 'auth':
      return `p${item.pageNumber}:OCR 模型认证失败，请检查 API key、额度权限或模型访问权限。${item.message}`;
    case 'rate_limited':
      return `p${item.pageNumber}:OCR 服务触发限流，请稍后重试或降低同时解析任务数量。${item.message}`;
    case 'timeout':
      return `p${item.pageNumber}:OCR 服务响应超时。${item.message}`;
    case 'payload_too_large':
      return `p${item.pageNumber}:OCR 输入超过上游限制，请拆分 PDF 后重试。${item.message}`;
    case 'bad_request':
      return `p${item.pageNumber}:OCR 请求参数或文件格式被上游拒绝。${item.message}`;
    case 'server':
      return `p${item.pageNumber}:OCR 服务端异常。${item.message}`;
    case 'network':
      return `p${item.pageNumber}:OCR 网络请求失败。${item.message}`;
    case 'empty_content':
      return `p${item.pageNumber}:OCR 未返回可用文本内容。${item.message}`;
    case 'local_conversion':
      return `p${item.pageNumber}:PDF 本地转图失败。${item.message}`;
    case 'unknown':
      return `p${item.pageNumber}:${item.message}`;
  }
}

function shouldAbortWholeVisionParse(classification: OcrErrorClassification): boolean {
  return classification.kind === 'auth' || classification.kind === 'bad_request';
}

type VisionPageImageResult =
  | {
      success: true;
      pageNum: number;
      markdownContent: string;
    }
  | {
      success: false;
      pageNum: number;
      error: unknown;
      classification: OcrErrorClassification;
    };

async function processRasterPagesWithAdaptiveConcurrency(args: {
  pageNumbers: readonly number[];
  rasterDocument: PdfRasterDocument;
  targetPixels: number;
  textGeneration: TextGenerationPort;
  documentOcr: DocumentOcrPort;
  documentOcrProfile?: DocumentOcrModelProfile;
  visionModelId: string;
  maxRetries: number;
  attemptTimeoutMs: number;
  initialConcurrency: number;
  onPageRasterized?: (pageNumber: number) => void;
  onPageSettled?: (pageNumber: number) => void;
}): Promise<VisionPageImageResult[]> {
  const results: VisionPageImageResult[] = [];
  let nextIndex = 0;
  let activeCount = 0;
  let currentConcurrency = Math.max(1, Math.floor(args.initialConcurrency));
  let abortScheduling = false;

  return new Promise(resolve => {
    const launchNext = () => {
      if ((abortScheduling || nextIndex >= args.pageNumbers.length) && activeCount === 0) {
        resolve(results.sort((a, b) => a.pageNum - b.pageNum));
        return;
      }

      while (
        !abortScheduling &&
        activeCount < currentConcurrency &&
        nextIndex < args.pageNumbers.length
      ) {
        const pageNum = args.pageNumbers[nextIndex];
        nextIndex += 1;
        activeCount += 1;

        const recognition = args.rasterDocument
          .renderPageToJpeg(pageNum, { targetPixels: args.targetPixels })
          .then(page => {
            args.onPageRasterized?.(pageNum);
            return args.documentOcrProfile
              ? recognizeDocumentImageByOcrPort({
                  documentOcr: args.documentOcr,
                  profile: args.documentOcrProfile,
                  imageBytes: page.jpegBytes,
                  pageNum,
                  retryOptions: {
                    maxRetries: args.maxRetries,
                    attemptTimeoutMs: args.attemptTimeoutMs,
                  },
                })
              : recognizeImageBytes(
                  page.jpegBytes,
                  pageNum,
                  args.textGeneration,
                  args.visionModelId,
                  {
                    maxRetries: args.maxRetries,
                    attemptTimeoutMs: args.attemptTimeoutMs,
                  }
                );
          });

        recognition
          .then(markdownContent => {
            results.push({
              success: true,
              pageNum,
              markdownContent,
            });
          })
          .catch((error: unknown) => {
            const classification = classifyOcrError(error);
            if (classification.shouldReduceConcurrency && currentConcurrency > 1) {
              currentConcurrency = 1;
              console.warn(
                `[VisionRecognitionStrategy] OCR ${classification.kind} 触发动态降并发，后续逐页执行`
              );
            }
            if (shouldAbortWholeVisionParse(classification)) {
              abortScheduling = true;
            }
            results.push({
              success: false,
              pageNum,
              error,
              classification,
            });
          })
          .finally(() => {
            args.onPageSettled?.(pageNum);
            activeCount -= 1;
            launchNext();
          });
      }
    };

    launchNext();
  });
}

async function recognizeDocumentByUpload(args: {
  pdfPath: string;
  documentOcr: DocumentOcrPort;
  profile: DocumentOcrModelProfile;
  retryOptions: { maxRetries: number; attemptTimeoutMs: number };
}): Promise<OcrDocumentPage[]> {
  const { pdfPath, documentOcr, profile, retryOptions } = args;
  const { maxRetries, attemptTimeoutMs } = retryOptions;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const requestStartTime = Date.now();
    try {
      const timeoutMessage = `AI识别超时（${Math.round(attemptTimeoutMs / 1000)}秒）`;
      const pages = await withAttemptTimeout({
        timeoutMs: attemptTimeoutMs,
        timeoutMessage,
        enableAbortSignal: profile.supportsAbortSignal,
        work: async (signal?: AbortSignal) => {
          const result = await documentOcr.recognizeDocument({
            modelId: profile.modelId,
            input: { kind: 'pdf_path', path: pdfPath },
            options: signal ? { signal } : {},
          });
          return result.pages;
        },
      });

      const nonEmptyPages = pages.filter(page => page.markdown.trim().length > 0);
      if (nonEmptyPages.length > 0) {
        return pages;
      }

      const emptyContentError = new EmptyOcrContentError('文档直传 OCR 返回空内容');
      const classification = classifyOcrError(emptyContentError);
      if (!shouldRetryOcrAttempt({ attempt, maxRetries, classification })) {
        throw createRetryExhaustedError({
          scope: 'PDF上传解析',
          maxRetries,
          cause: emptyContentError,
        });
      }
      await waitBeforeRetry({
        scope: 'PDF上传解析空内容',
        attempt,
        delayMs: readRetryDelayMs(emptyContentError, classification, attempt),
        classification,
      });
    } catch (error) {
      if (error instanceof OcrRetryExhaustedError) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const elapsedMs = Date.now() - requestStartTime;
      const classification = classifyOcrError(error);
      console.error(
        `[VisionRecognitionStrategy] PDF上传解析第 ${attempt} 次尝试失败(${classification.kind}): ${errorMessage} (耗时 ${elapsedMs}ms)`
      );

      if (!shouldRetryOcrAttempt({ attempt, maxRetries, classification })) {
        throw classification.retryable
          ? createRetryExhaustedError({ scope: 'PDF上传解析', maxRetries, cause: error })
          : error;
      }
      await waitBeforeRetry({
        scope: 'PDF上传解析',
        attempt,
        delayMs: readRetryDelayMs(error, classification, attempt),
        classification,
      });
    }
  }

  throw new Error(`PDF上传解析重试 ${maxRetries} 次后仍失败`);
}

async function recognizeDocumentImageByOcrPort(args: {
  documentOcr: DocumentOcrPort;
  profile: DocumentOcrModelProfile;
  imageBytes: Buffer;
  pageNum: number;
  retryOptions: { maxRetries: number; attemptTimeoutMs: number };
}): Promise<string> {
  const { documentOcr, profile, imageBytes, pageNum, retryOptions } = args;
  const { maxRetries, attemptTimeoutMs } = retryOptions;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const requestStartTime = Date.now();
    try {
      const timeoutMessage = `AI识别超时（${Math.round(attemptTimeoutMs / 1000)}秒）`;
      const pages = await withAttemptTimeout({
        timeoutMs: attemptTimeoutMs,
        timeoutMessage,
        enableAbortSignal: profile.supportsAbortSignal,
        work: async (signal?: AbortSignal) => {
          const result = await documentOcr.recognizeDocument({
            modelId: profile.modelId,
            input: {
              kind: 'image_base64',
              base64: imageBytes.toString('base64'),
              mimeType: 'image/jpeg',
              pageNumber: pageNum,
            },
            options: signal ? { signal } : {},
          });
          return result.pages;
        },
      });

      const content = pages
        .filter(page => page.pageNumber === pageNum || pages.length === 1)
        .map(page => page.markdown.trim())
        .filter(text => text.length > 0)
        .join('\n\n')
        .trim();
      if (content.length > 0) {
        return content;
      }

      const emptyContentError = new EmptyOcrContentError(
        `页面 ${pageNum} Document OCR 返回空内容`,
        { pageNum }
      );
      const classification = classifyOcrError(emptyContentError);
      if (!shouldRetryOcrAttempt({ attempt, maxRetries, classification })) {
        throw createRetryExhaustedError({
          scope: `页面 ${pageNum} Document OCR`,
          maxRetries,
          cause: emptyContentError,
        });
      }
      await waitBeforeRetry({
        scope: `页面 ${pageNum} Document OCR 空内容`,
        attempt,
        delayMs: readRetryDelayMs(emptyContentError, classification, attempt),
        classification,
      });
    } catch (error) {
      if (error instanceof OcrRetryExhaustedError) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const elapsedMs = Date.now() - requestStartTime;
      const classification = classifyOcrError(error);
      console.error(
        `[VisionRecognitionStrategy] 页面 ${pageNum} Document OCR 第 ${attempt} 次尝试失败(${classification.kind}): ${errorMessage} (耗时 ${elapsedMs}ms)`
      );

      if (!shouldRetryOcrAttempt({ attempt, maxRetries, classification })) {
        throw classification.retryable
          ? createRetryExhaustedError({
              scope: `页面 ${pageNum} Document OCR`,
              maxRetries,
              cause: error,
            })
          : error;
      }
      await waitBeforeRetry({
        scope: `页面 ${pageNum} Document OCR`,
        attempt,
        delayMs: readRetryDelayMs(error, classification, attempt),
        classification,
      });
    }
  }

  throw new Error(`页面 ${pageNum} Document OCR 重试 ${maxRetries} 次后仍失败`);
}

async function withAttemptTimeout<T>(args: {
  timeoutMs: number;
  timeoutMessage: string;
  enableAbortSignal: boolean;
  work: (signal?: AbortSignal) => Promise<T>;
}): Promise<T> {
  const { timeoutMs, timeoutMessage, enableAbortSignal, work } = args;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const controller = enableAbortSignal ? new AbortController() : null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      try {
        controller?.abort(new Error(timeoutMessage));
      } catch {
        controller?.abort();
      }
      reject(new OcrTimeoutError(timeoutMessage, { timeoutMs }));
    }, timeoutMs);
  });

  try {
    const workPromise = work(controller?.signal);
    return await Promise.race([workPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * **功能 (What):** Layer 3 - AI视觉处理
 * **输入 (Input / @param):**
 * @param data - PDF文件的二进制数据
 * @param docId - 文档ID
 * @param textGeneration - 非 Agent 文本生成端口
 * @param visionModelId - 视觉模型ID
 * @param options - 处理选项
 * @param updater - 进度更新器
 * **输出 (Output / @returns):** 解析后的ParsedBlock数组
 * **副作用 (Side-effects):** 创建临时文件，调用文本生成端口
 */
export async function processWithVision(
  data: Uint8Array,
  docId: string,
  textGeneration: TextGenerationPort,
  documentOcr: DocumentOcrPort,
  visionModelId: string,
  options: {
    targetPixels?: number;
    maxRetries?: number;
    tpmLimitPerWorker?: number;
  } = {},
  updater?: (progress: number, message: string) => void
): Promise<StrategyResult> {
  const outcome = await processWithVisionDiagnostics(
    data,
    docId,
    textGeneration,
    documentOcr,
    visionModelId,
    options,
    updater
  );

  if (!outcome.success) {
    return {
      success: false,
      error: outcome.error,
    };
  }

  return {
    success: true,
    blocks: outcome.blocks,
  };
}

export type VisionStrategyDiagnosticResult =
  | {
      success: true;
      blocks: ParsedBlock[];
      diagnostics: PdfParseDiagnostics;
    }
  | {
      success: false;
      error: string;
      diagnostics?: PdfParseDiagnostics;
    };

export async function processWithVisionDiagnostics(
  data: Uint8Array,
  docId: string,
  textGeneration: TextGenerationPort,
  documentOcr: DocumentOcrPort,
  visionModelId: string,
  options: {
    filename?: string;
    targetPixels?: number;
    maxRetries?: number;
    tpmLimitPerWorker?: number;
  } = {},
  updater?: (progress: number, message: string) => void
): Promise<VisionStrategyDiagnosticResult> {
  const { filename = `${docId}.pdf`, maxRetries = 5, tpmLimitPerWorker } = options;
  const targetPixels = normalizePdfRasterTargetPixels(
    options.targetPixels ?? PDF_RASTER_DEFAULT_TARGET_PIXELS
  );

  let tempDir: string | null = null;
  let rasterDocument: PdfRasterDocument | null = null;
  const pageDiagnostics: PdfPageDiagnostic[] = [];
  let activePipeline: PdfParsePipeline = 'vision_page_image';
  let resolvedTotalPages = 0;

  try {
    console.log('[VisionRecognitionStrategy] 开始AI视觉处理...');
    const documentOcrProfile = await documentOcr.resolveModelProfile(visionModelId);
    const attemptTimeoutMs = getAiRecognitionAttemptTimeoutMs(documentOcrProfile);
    let pdfPath: string | null = null;
    let totalPages: number;
    if (documentOcrProfile?.mode === 'document_upload') {
      totalPages = await getPdfPageCountCrossPlatform(data);
      const debugImagesPath = path.join(pathManager.getAppDataPath(), 'debug_images');
      tempDir = path.join(debugImagesPath, `pdf-vision-${docId}-${Date.now()}`);
      await fs.mkdir(tempDir, { recursive: true });
      pdfPath = path.join(tempDir, `${docId}.pdf`);
      await fs.writeFile(pdfPath, data);
    } else {
      rasterDocument = await openPdfRasterDocumentFromBytes(data);
      totalPages = rasterDocument.pageCount;
    }

    resolvedTotalPages = totalPages;
    console.log(`[VisionRecognitionStrategy] AI视觉处理，共 ${totalPages} 页`);
    if (documentOcrProfile) {
      // 只有真正进入视觉/OCR 层时才校验页数：智能解析的纯文本 PDF 不应被 OCR 上限误伤。
      assertDocumentOcrPageLimit({
        filename,
        pageCount: totalPages,
        profile: documentOcrProfile,
      });
    }

    const allBlocks: ParsedBlock[] = [];

    // ✅ 文档直传 OCR：支持直接上传 PDF，跳过“PDF→图片→逐页OCR”
    if (documentOcrProfile?.mode === 'document_upload') {
      activePipeline = 'vision_document_upload';
      if (updater) {
        updater(5, '上传原始文档并进行文档级版面解析（OCR）...');
      }

      if (!pdfPath) throw new Error('文档直传 OCR 缺少临时 PDF 路径');
      const markdownContent = await recognizeDocumentByUpload({
        pdfPath,
        documentOcr,
        profile: documentOcrProfile,
        retryOptions: {
          maxRetries,
          attemptTimeoutMs,
        },
      });

      const pages = markdownContent;
      const effectiveTotalPages = pages.length > 0 ? pages.length : totalPages;

      for (const page of pages) {
        const pageNum = page.pageNumber;
        const baseSourceInfo = { page_number: pageNum };
        const pageOffset = (pageNum - 1) * PAGE_BLOCK_INDEX_STRIDE;
        const pageBlocks = parseMarkdownToBlocks(
          docId,
          pageNum,
          page.markdown,
          baseSourceInfo,
          pageOffset
        );
        allBlocks.push(...pageBlocks);

        if (updater && effectiveTotalPages > 0) {
          const progressInAI =
            5 + (Math.min(pageNum - 1, effectiveTotalPages - 1) / effectiveTotalPages) * 85;
          updater(progressInAI, `OCR解析第 ${pageNum}/${effectiveTotalPages} 页...`);
        }
      }

      if (updater) {
        updater(90, `AI视觉识别完成，共生成 ${allBlocks.length} 个块`);
      }

      if (allBlocks.length === 0) {
        return { success: false, error: '文档直传 OCR 未提取到任何内容。' };
      }

      return {
        success: true,
        blocks: allBlocks,
        diagnostics: createPdfParseDiagnostics({
          pipeline: activePipeline,
          totalPages,
          blocks: allBlocks,
          failedPages: [],
        }),
      };
    }

    if (!rasterDocument) throw new Error('通用视觉 OCR 缺少 PDF 栅格化文档');
    let rasterizedPages = 0;
    let settledPages = 0;
    const pageImageResults = await processRasterPagesWithAdaptiveConcurrency({
      pageNumbers: Array.from({ length: totalPages }, (_, index) => index + 1),
      rasterDocument,
      targetPixels,
      textGeneration,
      documentOcr,
      documentOcrProfile,
      visionModelId,
      maxRetries,
      attemptTimeoutMs,
      initialConcurrency: PDF_VISION_MAX_IN_FLIGHT_PAGES,
      onPageRasterized(pageNumber) {
        rasterizedPages += 1;
        updater?.(
          5 + (rasterizedPages / totalPages) * 20,
          `准备第 ${pageNumber}/${totalPages} 页图像...`
        );
      },
      onPageSettled(pageNumber) {
        settledPages += 1;
        updater?.(
          25 + (settledPages / totalPages) * 65,
          `AI识别第 ${pageNumber}/${totalPages} 页...`
        );
      },
    });

    for (const result of pageImageResults) {
      const pageNum = result.pageNum;

      if (!result.success) {
        console.error(`[VisionRecognitionStrategy] 页面 ${pageNum} AI识别失败:`, result.error);
        const { classification } = result;
        const message = result.error instanceof Error ? result.error.message : String(result.error);
        pageDiagnostics.push({
          pageNumber: pageNum,
          errorKind: classification.kind,
          message,
          retryable: classification.retryable,
          shouldReduceConcurrency: classification.shouldReduceConcurrency,
          shouldSplitSmaller: classification.shouldSplitSmaller,
        });

        if (shouldAbortWholeVisionParse(classification)) {
          throw result.error;
        }

        // ✅ 设计选择：单页失败不应中断整篇文档
        // - 视觉 OCR 的目标是“尽可能多提取内容”，允许局部失败；
        // - 若所有页面都失败，会在循环结束后以 allBlocks.length===0 的方式返回失败（带摘要原因）。
        console.warn(`[VisionRecognitionStrategy] ⚠️ 页面 ${pageNum} 处理失败，继续下一页`);
        continue;
      }

      const markdownContent = result.markdownContent;

      // 记录token消耗
      if (tpmLimitPerWorker && markdownContent) {
        const inputTokens = calculateVisionTokensForOurImages(targetPixels);
        const outputTokens = estimateTextTokens(markdownContent);
        const totalTokens = inputTokens + outputTokens;
        console.log(
          `[VisionRecognitionStrategy] 页面${pageNum}: 输出${outputTokens} tokens, 总消耗${totalTokens} tokens`
        );
      }

      if (markdownContent) {
        // 传递一个预设的source_info，其中包含页码
        const baseSourceInfo = { page_number: pageNum };
        /**
         * ✅ 根因修复：blockId 必须在“跨页”范围内保持唯一
         *
         * 原实现的问题：
         * - parseMarkdownToBlocks 内部从 0 开始计数；
         * - VisionRecognitionStrategy 对每一页都调用一次 parseMarkdownToBlocks；
         * - 于是不同页的“第 0 个 block”在文本相同（例如旧 bug 产出 `[object Object]`）时会生成相同 UUIDv5，
         *   最终 SoT.content_blocks 被覆盖、root 里出现重复 blockId。
         *
         * 这里用固定 pageOffset（每页预留 10000 个索引位）来保证稳定且可复现的跨页唯一性。
         */
        const pageOffset = (pageNum - 1) * PAGE_BLOCK_INDEX_STRIDE;
        const pageBlocks = parseMarkdownToBlocks(
          docId,
          pageNum,
          markdownContent,
          baseSourceInfo,
          pageOffset
        );
        allBlocks.push(...pageBlocks);
        console.log(
          `[VisionRecognitionStrategy] 页面 ${pageNum} 识别成功，提取 ${pageBlocks.length} 个块`
        );
      }
    }

    if (
      pageImageResults.length > 0 &&
      pageImageResults.every(
        result => !result.success && result.classification.kind === 'local_conversion'
      )
    ) {
      console.warn('[VisionRecognitionStrategy] 所有页面本地转图失败，无法进入 OCR 阶段');
    }

    if (updater) {
      updater(90, `AI视觉识别完成，共生成 ${allBlocks.length} 个块`);
    }

    console.log(`[VisionRecognitionStrategy] AI视觉处理完成，生成 ${allBlocks.length} 个块`);

    if (allBlocks.length === 0) {
      const summary =
        pageDiagnostics.length > 0
          ? `原因: ${pageDiagnostics.slice(0, 3).map(describePageDiagnosticForUser).join('; ')}${pageDiagnostics.length > 3 ? ' ...' : ''}`
          : '原因未知';
      return {
        success: false,
        error: `AI视觉未提取到任何内容。${summary}`,
        diagnostics: createPdfParseDiagnostics({
          pipeline: activePipeline,
          totalPages,
          blocks: allBlocks,
          failedPages: pageDiagnostics,
        }),
      };
    }

    return {
      success: true,
      blocks: allBlocks,
      diagnostics: createPdfParseDiagnostics({
        pipeline: activePipeline,
        totalPages,
        blocks: allBlocks,
        failedPages: pageDiagnostics,
      }),
    };
  } catch (error) {
    const errorMessage = `AI视觉处理失败: ${describeOcrFailureForUser(error)}`;
    return {
      success: false,
      error: errorMessage,
      ...(resolvedTotalPages > 0
        ? {
            diagnostics: createPdfParseDiagnostics({
              pipeline: activePipeline,
              totalPages: resolvedTotalPages,
              blocks: [],
              failedPages: [],
            }),
          }
        : {}),
    };
  } finally {
    await rasterDocument?.close().catch(() => undefined);
    // 清理临时目录
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function processPdfPagesWithVisionDiagnostics(
  pdfPath: string,
  docId: string,
  pageNumbers: number[],
  totalPages: number,
  textGeneration: TextGenerationPort,
  documentOcr: DocumentOcrPort,
  visionModelId: string,
  options: {
    targetPixels?: number;
    maxRetries?: number;
    tpmLimitPerWorker?: number;
  } = {},
  updater?: (progress: number, message: string) => void
): Promise<VisionStrategyDiagnosticResult> {
  const { maxRetries = 5, tpmLimitPerWorker } = options;
  const targetPixels = normalizePdfRasterTargetPixels(
    options.targetPixels ?? PDF_RASTER_DEFAULT_TARGET_PIXELS
  );
  const uniquePages = Array.from(new Set(pageNumbers))
    .filter(pageNum => Number.isInteger(pageNum) && pageNum > 0 && pageNum <= totalPages)
    .sort((a, b) => a - b);

  const allBlocks: ParsedBlock[] = [];
  const pageDiagnostics: PdfPageDiagnostic[] = [];
  const documentOcrProfile = await documentOcr.resolveModelProfile(visionModelId);
  const attemptTimeoutMs = getAiRecognitionAttemptTimeoutMs(documentOcrProfile);
  const useDedicatedDocumentOcr = documentOcrProfile !== undefined;
  const rasterDocument = await openPdfRasterDocumentFromPath(pdfPath);

  try {
    for (let index = 0; index < uniquePages.length; index += 1) {
      const pageNum = uniquePages[index];
      if (updater) {
        updater((index / uniquePages.length) * 90, `重新解析第 ${pageNum} 页...`);
      }

      try {
        const pageImage = await rasterDocument.renderPageToJpeg(pageNum, { targetPixels });
        const markdownContent = useDedicatedDocumentOcr
          ? await recognizeDocumentImageByOcrPort({
              documentOcr,
              profile: documentOcrProfile,
              imageBytes: pageImage.jpegBytes,
              pageNum,
              retryOptions: {
                maxRetries,
                attemptTimeoutMs,
              },
            })
          : await recognizeImageBytes(pageImage.jpegBytes, pageNum, textGeneration, visionModelId, {
              maxRetries,
              attemptTimeoutMs,
            });

        if (!markdownContent) {
          throw new Error(`页面 ${pageNum} AI识别返回空内容`);
        }

        const baseSourceInfo = { page_number: pageNum };
        const pageOffset = (pageNum - 1) * PAGE_BLOCK_INDEX_STRIDE;
        allBlocks.push(
          ...parseMarkdownToBlocks(docId, pageNum, markdownContent, baseSourceInfo, pageOffset)
        );

        if (tpmLimitPerWorker) {
          const inputTokens = calculateVisionTokensForOurImages(targetPixels);
          const outputTokens = estimateTextTokens(markdownContent);
          console.log(
            `[VisionRecognitionStrategy] 续跑页面${pageNum}: 输出${outputTokens} tokens, 总消耗${inputTokens + outputTokens} tokens`
          );
        }
      } catch (error) {
        const classification = classifyOcrError(error);
        pageDiagnostics.push({
          pageNumber: pageNum,
          errorKind: classification.kind,
          message: error instanceof Error ? error.message : String(error),
          retryable: classification.retryable,
          shouldReduceConcurrency: classification.shouldReduceConcurrency,
          shouldSplitSmaller: classification.shouldSplitSmaller,
        });

        if (shouldAbortWholeVisionParse(classification)) {
          return {
            success: false,
            error: describeOcrFailureForUser(error),
            diagnostics: createPdfParseDiagnostics({
              pipeline:
                documentOcrProfile?.mode === 'document_upload'
                  ? 'vision_document_upload'
                  : 'vision_page_image',
              totalPages,
              blocks: allBlocks,
              failedPages: pageDiagnostics,
            }),
          };
        }
      }
    }

    if (updater) {
      updater(90, `失败页续跑完成，共生成 ${allBlocks.length} 个块`);
    }

    if (allBlocks.length === 0) {
      return {
        success: false,
        error:
          pageDiagnostics.length > 0
            ? `失败页续跑未提取到内容: ${pageDiagnostics.map(describePageDiagnosticForUser).join('; ')}`
            : '失败页续跑未提取到内容',
        diagnostics: createPdfParseDiagnostics({
          pipeline:
            documentOcrProfile?.mode === 'document_upload'
              ? 'vision_document_upload'
              : 'vision_page_image',
          totalPages,
          blocks: allBlocks,
          failedPages: pageDiagnostics,
        }),
      };
    }

    return {
      success: true,
      blocks: allBlocks,
      diagnostics: createPdfParseDiagnostics({
        pipeline:
          documentOcrProfile?.mode === 'document_upload'
            ? 'vision_document_upload'
            : 'vision_page_image',
        totalPages,
        blocks: allBlocks,
        failedPages: pageDiagnostics,
      }),
    };
  } finally {
    await rasterDocument.close();
  }
}

/**
 * **功能 (What):** 使用AI引擎识别图像内容
 * **输入 (Input / @param):**
 * @param imageBase64 - base64编码的图像
 * @param pageNum - 页码
 * @param textGeneration - 非 Agent 文本生成端口
 * @param visionModelId - 视觉模型ID
 * @param maxRetries - 最大重试次数
 * **输出 (Output / @returns):** 识别的文本内容
 * **副作用 (Side-effects):** 调用文本生成端口
 */
export async function recognizeImageContent(
  imageBase64: string,
  pageNum: number,
  textGeneration: TextGenerationPort,
  visionModelId: string,
  retryOptions:
    | {
        maxRetries?: number;
        attemptTimeoutMs?: number;
      }
    | number = 5
): Promise<string> {
  return recognizeImageBytes(
    Buffer.from(imageBase64, 'base64'),
    pageNum,
    textGeneration,
    visionModelId,
    retryOptions
  );
}

async function recognizeImageBytes(
  imageBytes: Buffer,
  pageNum: number,
  textGeneration: TextGenerationPort,
  visionModelId: string,
  retryOptions:
    | {
        maxRetries?: number;
        attemptTimeoutMs?: number;
      }
    | number = 5
): Promise<string> {
  const resolvedMaxRetries =
    typeof retryOptions === 'number' ? retryOptions : (retryOptions.maxRetries ?? 5);
  const defaultAttemptTimeoutMs = getAiRecognitionAttemptTimeoutMs();
  const attemptTimeoutMs =
    typeof retryOptions === 'number'
      ? defaultAttemptTimeoutMs
      : (retryOptions.attemptTimeoutMs ?? defaultAttemptTimeoutMs);

  for (let attempt = 1; attempt <= resolvedMaxRetries; attempt++) {
    const requestStartTime = Date.now(); // 记录每次尝试耗时，便于定位长尾/超时

    try {
      const timeoutMessage = `AI识别超时（${Math.round(attemptTimeoutMs / 1000)}秒）`;

      const response = await withAttemptTimeout({
        timeoutMs: attemptTimeoutMs,
        timeoutMessage,
        // canonical inference 的正式合同支持 AbortSignal，超时必须中断本次 Provider 调用。
        enableAbortSignal: true,
        work: async (signal?: AbortSignal) => {
          return textGeneration.generate({
            modelId: visionModelId,
            messages: [
              { role: 'system', content: pdfOcrPrompt.content },
              {
                role: 'user',
                content: [
                  {
                    type: 'image',
                    mediaType: 'image/jpeg',
                    bytes: imageBytes,
                  },
                ],
              },
            ],
            maxOutputTokens: 4_000,
            temperature: 0.1,
            signal,
          });
        },
      });

      const content = response.text.trim();

      if (content && content.length > 0) {
        console.log(
          `[VisionRecognitionStrategy] 页面 ${pageNum} AI识别成功，内容长度: ${content.length}`
        );
        return content;
      }

      const emptyContentError = new EmptyOcrContentError(`页面 ${pageNum} AI识别返回空内容`, {
        pageNum,
      });
      const classification = classifyOcrError(emptyContentError);
      if (
        !shouldRetryOcrAttempt({
          attempt,
          maxRetries: resolvedMaxRetries,
          classification,
        })
      ) {
        throw createRetryExhaustedError({
          scope: `页面 ${pageNum} AI识别`,
          maxRetries: resolvedMaxRetries,
          cause: emptyContentError,
        });
      }
      await waitBeforeRetry({
        scope: `页面 ${pageNum} 空内容`,
        attempt,
        delayMs: readRetryDelayMs(emptyContentError, classification, attempt),
        classification,
      });
    } catch (error) {
      if (error instanceof OcrRetryExhaustedError) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const elapsedMs = Date.now() - requestStartTime;
      const classification = classifyOcrError(error);
      console.error(
        `[VisionRecognitionStrategy] 页面 ${pageNum} AI识别第 ${attempt} 次尝试失败(${classification.kind}): ${errorMessage} (耗时 ${elapsedMs}ms)`
      );

      if (
        !shouldRetryOcrAttempt({
          attempt,
          maxRetries: resolvedMaxRetries,
          classification,
        })
      ) {
        throw classification.retryable
          ? createRetryExhaustedError({
              scope: `页面 ${pageNum} AI识别`,
              maxRetries: resolvedMaxRetries,
              cause: error,
            })
          : error;
      }

      await waitBeforeRetry({
        scope: `页面 ${pageNum} AI识别`,
        attempt,
        delayMs: readRetryDelayMs(error, classification, attempt),
        classification,
      });
    }
  }

  throw new Error(`页面 ${pageNum} AI识别重试 ${resolvedMaxRetries} 次后仍失败`);
}
