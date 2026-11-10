/**
 * 按页读取 PDF：文字层与单页图片共用同一个 PDF.js 文档句柄。
 *
 * 知识库摄取一次解析整份文档；Agent 阅读只解析被请求的页，读完立即释放页面缓存，
 * 千页文件也不会因为读一页而整本展开。本模块不调用任何模型。
 */

import { extractTextItemsFromPage } from '../adapters/PdfjsAdapter';
import { createPdfRasterDocument } from '../adapters/PdfRasterAdapter';
import { openPdfDocument } from '../adapters/pdfJsRuntime';
import type { RasterizedPdfPage } from '../definitions/pdfRaster';
import { assembleColumnLines, assembleColumnsText } from '../functions/assemblePageText';
import { analyzePageLayout } from '../layout/LayoutAnalyzer';
import { groupItemsByColumns } from '../layout/XYCutAlgorithm';

/**
 * direct：单栏或带阅读顺序标签；columns：规则多栏，已按栏重排；
 * complex：版面不规则，按坐标顺序给出，阅读顺序可能不对；no_text：没有文字层（扫描页或纯图片）。
 */
export type PdfPageLayout = 'direct' | 'columns' | 'complex' | 'no_text';

export interface PdfPageText {
  readonly pageNumber: number;
  readonly text: string;
  readonly layout: PdfPageLayout;
}

export interface PdfPageReader {
  readonly pageCount: number;
  readPageText(pageNumber: number): Promise<PdfPageText>;
  renderPageToJpeg(
    pageNumber: number,
    options?: { readonly targetPixels?: number },
  ): Promise<RasterizedPdfPage>;
  close(): Promise<void>;
}

export async function openPdfPageReader(data: Uint8Array): Promise<PdfPageReader> {
  const handle = await openPdfDocument(data);
  const raster = createPdfRasterDocument(handle);
  const { document } = handle;

  const requirePage = (pageNumber: number) => {
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) {
      throw new RangeError(`PDF 页码 ${pageNumber} 超出范围 1–${document.numPages}`);
    }
  };

  return {
    pageCount: document.numPages,
    async readPageText(pageNumber: number): Promise<PdfPageText> {
      requirePage(pageNumber);
      const page = await document.getPage(pageNumber);
      try {
        const items = await extractTextItemsFromPage(page, pageNumber);
        if (!items.some(item => item.str.trim().length > 0)) {
          return { pageNumber, text: '', layout: 'no_text' };
        }
        const layout = await analyzePageLayout(page);
        if (layout.strategy === 'geometric' && layout.xPeaks.length > 1) {
          return {
            pageNumber,
            text: assembleColumnsText(groupItemsByColumns(items, layout.xPeaks)),
            layout: 'columns',
          };
        }
        return {
          pageNumber,
          text: assembleColumnLines(items),
          layout: layout.strategy === 'vision' ? 'complex' : 'direct',
        };
      } finally {
        page.cleanup();
      }
    },
    renderPageToJpeg(pageNumber, options) {
      requirePage(pageNumber);
      return raster.renderPageToJpeg(pageNumber, options);
    },
    close: () => raster.close(),
  };
}
