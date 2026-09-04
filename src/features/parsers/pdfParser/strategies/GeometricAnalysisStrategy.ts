/**
 * Layer 2：基于 PDF.js 文本坐标处理规则多栏 PDF。
 */

import type { ParsedBlock } from '../../types';
import { loadPdfDocument } from '../adapters/PdfjsAdapter';
import { analyzePageLayout } from '../layout/LayoutAnalyzer';
import { extractTextDirect, extractTextWithXYCut } from '../layout/XYCutAlgorithm';
import type { StrategyResult } from '../types';
import { convertTextToBlocks } from '../utils/dataConverters';

export async function tryGeometricExtraction(
  data: Uint8Array,
  docId: string,
  updater?: (progress: number, message: string) => void
): Promise<StrategyResult> {
  let handle: Awaited<ReturnType<typeof loadPdfDocument>> | null = null;

  try {
    console.log('[GeometricAnalysisStrategy] 开始几何分析...');
    handle = await loadPdfDocument(data);
    const { document } = handle;
    const allBlocks: ParsedBlock[] = [];
    let blockIdCounter = 0;

    for (let pageNum = 1; pageNum <= document.numPages; pageNum += 1) {
      updater?.(
        30 + ((pageNum - 1) / document.numPages) * 50,
        `分析第 ${pageNum}/${document.numPages} 页布局...`
      );

      const page = await document.getPage(pageNum);
      try {
        const complexity = await analyzePageLayout(page);
        console.log(
          `[GeometricAnalysisStrategy] 页面 ${pageNum} 布局分析: ${complexity.strategy}, ${complexity.columnCount}栏, 置信度: ${complexity.confidence.toFixed(2)}`
        );

        if (complexity.strategy === 'vision') {
          return {
            success: false,
            error: `页面 ${pageNum} 布局过于复杂，需要视觉识别`,
          };
        }

        const pageText =
          complexity.strategy === 'direct'
            ? await extractTextDirect(page)
            : await extractTextWithXYCut(page);
        const pageBlocks = convertTextToBlocks(pageText, docId, pageNum, blockIdCounter);
        allBlocks.push(...pageBlocks);
        blockIdCounter += pageBlocks.length;
      } finally {
        page.cleanup();
      }
    }

    console.log(`[GeometricAnalysisStrategy] 几何分析成功，生成 ${allBlocks.length} 个块`);
    return { success: true, blocks: allBlocks };
  } catch (error) {
    return {
      success: false,
      error: `PDF.js 处理失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
