import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

import type { TextItem } from '../types';
import { openPdfDocument } from './pdfJsRuntime';

export interface LoadedPdfDocument {
  readonly document: PDFDocumentProxy;
  close(): Promise<void>;
}

/**
 * 文本、几何与栅格化路径共用的 PDF.js 文档入口。
 * 调用方必须关闭返回的 handle，释放 PDF.js 的字体、页面和解析缓存。
 */
export async function loadPdfDocument(data: Uint8Array): Promise<LoadedPdfDocument> {
  try {
    return await openPdfDocument(data);
  } catch (error) {
    throw new Error(`PDF.js 处理失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function extractTextItemsFromPage(
  page: PDFPageProxy,
  pageNumber?: number
): Promise<TextItem[]> {
  const textContent = await page.getTextContent({ disableNormalization: false });
  return textContent.items.flatMap(item => {
    if (!('str' in item)) return [];
    const transform = readFiniteNumberArray(item.transform);
    if (!transform || !Number.isFinite(item.width) || !Number.isFinite(item.height)) return [];
    return [
      {
        str: item.str,
        transform,
        width: item.width,
        height: item.height,
        ...(pageNumber === undefined ? {} : { page: pageNumber }),
      },
    ];
  });
}

function readFiniteNumberArray(values: readonly unknown[]): number[] | null {
  const result: number[] = [];
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    result.push(value);
  }
  return result;
}
