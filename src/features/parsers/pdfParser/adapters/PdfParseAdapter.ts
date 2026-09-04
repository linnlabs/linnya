import type { TextItem } from '../types';
import { extractTextItemsFromPage, loadPdfDocument } from './PdfjsAdapter';
import { loadPdfJsRuntime } from './pdfJsRuntime';

interface PdfParseData {
  numpages: number;
  numrender: number;
  info: Record<string, unknown>;
  metadata: Record<string, unknown>;
  text: string;
  version: string;
  items: TextItem[];
}

export async function extractWithPdfJs(data: Uint8Array): Promise<PdfParseData> {
  const handle = await loadPdfDocument(data);
  const { document } = handle;
  try {
    const items: TextItem[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        items.push(...(await extractTextItemsFromPage(page, pageNumber)));
      } finally {
        page.cleanup();
      }
    }

    const metadataResult = await document.getMetadata().catch(() => null);
    const info = readRecordProperty(metadataResult, 'info');
    const metadata = readPdfMetadata(metadataResult);
    const pdfjs = await loadPdfJsRuntime();

    return {
      numpages: document.numPages,
      numrender: items.length,
      info,
      metadata,
      text: items.map(item => item.str).join('\n'),
      version: pdfjs.version,
      items,
    };
  } catch (error) {
    throw new Error(`PDF.js 处理失败: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await handle.close();
  }
}

export async function getPdfPageCountCrossPlatform(data: Uint8Array): Promise<number> {
  const handle = await loadPdfDocument(data);
  try {
    return handle.document.numPages;
  } finally {
    await handle.close();
  }
}

export function evaluateExtractionQuality(result: { text: string; numpages: number }): {
  textDensity: number;
  isGoodQuality: boolean;
  reason?: string;
} {
  if (result.numpages === 0) {
    return { textDensity: 0, isGoodQuality: false, reason: 'PDF文件没有页面' };
  }
  const textDensity = result.text.length / result.numpages;
  return textDensity < 50
    ? {
        textDensity,
        isGoodQuality: false,
        reason: `文本密度较低 (${textDensity.toFixed(1)}字符/页)，适合使用AI视觉识别`,
      }
    : { textDensity, isGoodQuality: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecordProperty(value: unknown, property: string): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const candidate = value[property];
  return isRecord(candidate) ? candidate : {};
}

function readPdfMetadata(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const candidate = value.metadata;
  if (!candidate || typeof candidate !== 'object') return {};
  const getAll = Reflect.get(candidate, 'getAll');
  if (typeof getAll !== 'function') return {};
  const entries: unknown = Reflect.apply(getAll, candidate, []);
  return isRecord(entries) ? entries : {};
}
