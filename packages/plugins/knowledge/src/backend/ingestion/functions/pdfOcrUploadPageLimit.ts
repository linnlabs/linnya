import path from 'path';
import { readFile } from 'node:fs/promises';
import type { KnowledgeBase } from '../../domain/knowledgeBase';
import { getPdfPageCountCrossPlatform } from 'src/features/parsers/pdfParser/adapters/PdfParseAdapter';
import { resolveModelIdFromPolicy } from 'src/app-hosts/linnya/agent-registry/modelPolicyResolver';
import {
  PDF_OCR_DEFAULT_FALLBACK_MODEL_ID,
  PDF_OCR_MODEL_POLICY,
} from 'src/app-hosts/linnya/agent-registry/internals/ingestion/pdf_ocr';
import {
  assertDocumentOcrPageLimit,
  hasDocumentOcrPageLimit,
  type DocumentOcrPort,
} from 'src/domains/document-ocr';

export type PdfOcrUploadPageLimitDeps = {
  getPageCount?: (filePath: string) => Promise<number>;
  getDefaultModelId?: (capability: string) => string | undefined;
};

export type KnowledgeBaseLookupPort = {
  getKnowledgeBaseById(kbId: string): Promise<KnowledgeBase | undefined>;
};

function isPdfFilename(filename: string): boolean {
  return path.extname(filename).toLowerCase() === '.pdf';
}

async function readPdfPageCountFromFile(filePath: string): Promise<number> {
  const bytes = await readFile(filePath);
  return getPdfPageCountCrossPlatform(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  );
}

/**
 * 校验强制 OCR 上传页数上限。
 *
 * 为什么在摄入 feature 内做：
 * - PaddleOCR 端点超过 100 页会静默忽略后续页，不能让这种半截内容进入知识库；
 * - 智能解析会先尝试文本提取，所以这里只服务“用户已明确要求强制 OCR”的上传前拦截。
 */
export async function validatePdfOcrUploadPageLimit(args: {
  kbLookup: KnowledgeBaseLookupPort;
  kbId: string;
  filename: string;
  filePath: string;
  requestedPdfOcrModelId: unknown;
  documentOcr: DocumentOcrPort;
  deps?: PdfOcrUploadPageLimitDeps;
}): Promise<void> {
  if (!isPdfFilename(args.filename)) return;

  const kb = await args.kbLookup.getKnowledgeBaseById(args.kbId);
  const explicitPdfOcrModelId =
    typeof args.requestedPdfOcrModelId === 'string' && args.requestedPdfOcrModelId.trim().length > 0
      ? args.requestedPdfOcrModelId.trim()
      : undefined;
  const modelId =
    explicitPdfOcrModelId ??
    resolveModelIdFromPolicy(PDF_OCR_MODEL_POLICY, {
      kbPdfOcrModelId: kb?.pdfOcrModelId,
      kbVisionModelId: kb?.visionModelId,
      defaultVisionModelId: PDF_OCR_DEFAULT_FALLBACK_MODEL_ID,
      resolveByCapability: args.deps?.getDefaultModelId,
    }) ??
    PDF_OCR_DEFAULT_FALLBACK_MODEL_ID;

  const profile = await args.documentOcr.resolveModelProfile(modelId);
  if (!hasDocumentOcrPageLimit(profile)) return;

  const pageCount = args.deps?.getPageCount
    ? await args.deps.getPageCount(args.filePath)
    : await readPdfPageCountFromFile(args.filePath);
  assertDocumentOcrPageLimit({
    filename: args.filename,
    pageCount,
    profile,
  });
}
