import { countPluginPdfPages } from '@plugin/backend/documentParsingRuntime';
import { getPluginModelConfigurationPort } from '@plugin/backend/modelConfiguration';
import path from 'path';
import { readFile } from 'node:fs/promises';
import type { KnowledgeBase } from '../../domain/knowledgeBase';
import { type DocumentOcrPort } from '@plugin/backend/inferenceRuntime';
import {
  assertDocumentOcrPageLimit,
  hasDocumentOcrPageLimit,
} from '@plugin/backend/documentParsingRuntime';

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
  return countPluginPdfPages(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
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
    kb?.pdfOcrModelId ??
    kb?.visionModelId ??
    (args.deps?.getDefaultModelId
      ? args.deps.getDefaultModelId('pdf_ocr_default')
      : getPluginModelConfigurationPort().readDefaultModelIdByCapability('pdf_ocr_default'));
  if (!modelId) throw new Error('请先配置 PDF OCR 模型后上传 PDF');

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
