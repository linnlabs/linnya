/**
 * 根据 PDF.js 文本坐标判断页面是否适合直接提取、规则分栏或视觉识别。
 */

import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

import { extractTextItemsFromPage } from '../adapters/PdfjsAdapter';
import type { LayoutComplexity } from '../types';
import { findXCoordinatePeaks, isRegularColumnLayout } from './PeakDetector';

export async function analyzePageLayout(page: PDFPageProxy): Promise<LayoutComplexity> {
  try {
    const structTree = await page.getStructTree().catch(() => null);
    if (hasValidReadingOrder(structTree)) {
      return {
        columnCount: 1,
        xPeaks: [],
        confidence: 0.95,
        strategy: 'direct',
        textDensity: 0,
      };
    }

    const items = await extractTextItemsFromPage(page);
    if (items.length === 0) {
      return {
        columnCount: 0,
        xPeaks: [],
        confidence: 0,
        strategy: 'vision',
        textDensity: 0,
      };
    }

    const xPeaks = findXCoordinatePeaks(items);
    console.log(`[LayoutAnalyzer] 页面x坐标峰值: [${xPeaks.map(p => p.toFixed(0)).join(', ')}]`);
    const textDensity = items.reduce((sum, item) => sum + item.str.length, 0);

    if (xPeaks.length === 1) {
      return {
        columnCount: 1,
        xPeaks,
        confidence: 0.9,
        strategy: 'direct',
        textDensity,
      };
    }

    if (xPeaks.length <= 3 && isRegularColumnLayout(items, xPeaks)) {
      return {
        columnCount: xPeaks.length,
        xPeaks,
        confidence: 0.7,
        strategy: 'geometric',
        textDensity,
      };
    }

    return {
      columnCount: xPeaks.length,
      xPeaks,
      confidence: 0.3,
      strategy: 'vision',
      textDensity,
    };
  } catch (error) {
    console.warn('[LayoutAnalyzer] 布局分析失败:', error);
    return {
      columnCount: 0,
      xPeaks: [],
      confidence: 0,
      strategy: 'vision',
      textDensity: 0,
    };
  }
}

export function hasValidReadingOrder(structTree: unknown): boolean {
  if (!isRecord(structTree)) return false;
  const children = structTree.children;
  return Array.isArray(children) && children.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
