import path from 'node:path';
import type {
  DocumentParsingInference,
  PluginDocumentParseRequest,
  PluginDocumentParseResult,
  PluginPdfPagesParseRequest,
  VisionStrategyDiagnosticResult,
} from '@linnya/plugin-host-contract/backend/documentParsingRuntime';

export { hasDocumentOcrPageLimit, assertDocumentOcrPageLimit } from '../../domains/document-ocr/features/recognition/functions/assertDocumentOcrPageLimit';
export type * from '@linnya/plugin-host-contract/backend/documentParsingRuntime';
export { generateBlockId as generateParsedBlockId } from '../../shared/utils/idUtils';

/** 按需加载唯一解析实现；注册 SDK 时不加载 PDF/Office/模型目录等昂贵依赖。 */
export async function parsePluginDocument(
  request: PluginDocumentParseRequest,
  inference: DocumentParsingInference,
): Promise<PluginDocumentParseResult> {
  request.signal?.throwIfAborted();
  const extension = path.extname(request.filename).toLowerCase();
  const progress = request.onProgress
    ? (value: number, message: string) => {
        if (!request.signal?.aborted) request.onProgress?.(value, message);
      }
    : undefined;
  if (extension === '.pdf') {
    const { createSmartPdfParser, createVisionPdfParser } = await import('../../features/parsers/pdfParser/factory');
    const options = {
      documentOcr: inference.documentOcr,
      filename: request.filename,
      temporaryDirectory: request.temporaryDirectory,
      signal: request.signal,
    };
    const parser = request.forceVisionMode
      ? createVisionPdfParser(inference.textGeneration, request.pdfOcrModelId ?? '', options)
      : createSmartPdfParser(inference.textGeneration, request.pdfOcrModelId, options);
    const outcome = await parser.parseWithDiagnostics(request.bytes, request.documentId, progress);
    request.signal?.throwIfAborted();
    return { ...outcome, parser: 'PdfParser' };
  }
  const { ImageParser, parseImageWithAi } = await import('../../features/parsers/imageParser');
  if (ImageParser.isSupportedImageFormat(extension)) {
    if (!request.imageVisionModelId) throw new Error('缺少图片视觉模型，无法解析图片文档');
    const blocks = await parseImageWithAi(request.bytes, request.documentId, inference.textGeneration, request.imageVisionModelId, progress, request.signal);
    return { blocks, parser: 'ImageParser' };
  }
  const { getParser } = await import('../../features/parsers');
  request.signal?.throwIfAborted();
  const parser = getParser(extension);
  if (!parser) throw new Error(`不支持的文件类型: ${extension}`);
  const blocks = await parser.parse(request.bytes, request.documentId, progress);
  request.signal?.throwIfAborted();
  return { blocks, parser: parser.constructor.name };
}

export async function countPluginPdfPages(bytes: Uint8Array): Promise<number> {
  const { getPdfPageCountCrossPlatform } = await import('../../features/parsers/pdfParser/adapters/PdfParseAdapter');
  return getPdfPageCountCrossPlatform(bytes);
}

export async function parsePluginPdfPages(
  request: PluginPdfPagesParseRequest,
  inference: DocumentParsingInference,
): Promise<VisionStrategyDiagnosticResult> {
  request.signal?.throwIfAborted();
  const { processPdfPagesWithVisionDiagnostics } = await import('../../features/parsers/pdfParser/strategies/VisionRecognitionStrategy');
  const outcome = await processPdfPagesWithVisionDiagnostics(
    request.path, request.documentId, [...request.pages], request.totalPages,
    inference.textGeneration, inference.documentOcr, request.modelId,
    { maxRetries: 5, tpmLimitPerWorker: 20, temporaryDirectory: request.temporaryDirectory, signal: request.signal },
  );
  request.signal?.throwIfAborted();
  return outcome;
}
