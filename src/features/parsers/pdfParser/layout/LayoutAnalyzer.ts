/**
 * @file src/parsers/pdfParser/layout/LayoutAnalyzer.ts
 * 
 * **功能 (What):** PDF页面布局分析器，评估复杂度并推荐处理策略
 * **输入 (Input):** PDF页面对象
 * **输出 (Output):** 布局复杂度分析结果
 * **副作用 (Side-effects):** 无副作用，纯分析功能
 */

import { LayoutComplexity, TextItem } from '../types';
import { findXCoordinatePeaks, isRegularColumnLayout } from './PeakDetector';

/**
 * **功能 (What):** 分析页面布局复杂度
 * **输入 (Input / @param):** 
 * @param page - PDF页面对象
 * **输出 (Output / @returns):** 布局复杂度分析结果
 * **副作用 (Side-effects):** 无副作用，纯分析函数
 */
export async function analyzePageLayout(page: any): Promise<LayoutComplexity> {
  try {
    // 1. 检查是否有结构树（最优先）
    const structTree = await page.getStructTree().catch(() => null);
    if (structTree && hasValidReadingOrder(structTree)) {
      return {
        columnCount: 1,
        xPeaks: [],
        confidence: 0.95,
        strategy: 'direct',
        textDensity: 0
      };
    }

    // 2. 获取文本内容进行几何分析
    const textContent = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false
    });

    const items = textContent.items as TextItem[];
    if (!items || items.length === 0) {
      return {
        columnCount: 0,
        xPeaks: [],
        confidence: 0.0,
        strategy: 'vision',
        textDensity: 0
      };
    }

    // 3. x坐标直方图分析
    const xPeaks = findXCoordinatePeaks(items);
    console.log(`[LayoutAnalyzer] 页面x坐标峰值: [${xPeaks.map(p => p.toFixed(0)).join(', ')}]`);

    // 4. 计算文本密度
    const totalText = items.reduce((sum, item) => sum + item.str.length, 0);
    const textDensity = totalText;

    // 5. 决策逻辑
    let strategy: 'direct' | 'geometric' | 'vision';
    let confidence: number;

    if (xPeaks.length === 1) {
      // 单栏布局
      strategy = 'direct';
      confidence = 0.9;
    } else if (xPeaks.length <= 3 && isRegularColumnLayout(items, xPeaks)) {
      // 规则多栏布局
      strategy = 'geometric';
      confidence = 0.7;
    } else {
      // 复杂布局，需要视觉处理
      strategy = 'vision';
      confidence = 0.3;
    }

    return {
      columnCount: xPeaks.length,
      xPeaks,
      confidence,
      strategy,
      textDensity
    };

  } catch (error) {
    console.warn(`[LayoutAnalyzer] 布局分析失败:`, error);
    return {
      columnCount: 0,
      xPeaks: [],
      confidence: 0.0,
      strategy: 'vision',
      textDensity: 0
    };
  }
}

/**
 * **功能 (What):** 检查结构树是否有有效的阅读顺序
 * **输入 (Input / @param):** 
 * @param structTree - PDF结构树
 * **输出 (Output / @returns):** 是否有有效阅读顺序
 * **副作用 (Side-effects):** 无副作用，纯检查函数
 */
export function hasValidReadingOrder(structTree: any): boolean {
  // 简单检查：结构树是否存在且非空
  return structTree && structTree.children && structTree.children.length > 0;
}

/**
 * **功能 (What):** 评估文本布局的规律性
 * **输入 (Input / @param):** 
 * @param items - 文本项目数组
 * **输出 (Output / @returns):** 规律性分数（0-1）
 * **副作用 (Side-effects):** 无副作用，纯评估函数
 */
export function evaluateLayoutRegularity(items: TextItem[]): number {
  if (!items || items.length < 10) {
    return 0; // 文本项目太少，无法评估
  }

  // 1. 检查行间距的一致性
  const yCoords = items.map(item => item.transform[5]).sort((a, b) => b - a);
  const lineSpacings: number[] = [];
  
  for (let i = 1; i < yCoords.length; i++) {
    const spacing = Math.abs(yCoords[i - 1] - yCoords[i]);
    if (spacing > 5) { // 只考虑明显的行间距
      lineSpacings.push(spacing);
    }
  }

  // 2. 计算行间距的变异系数
  if (lineSpacings.length === 0) return 0;
  
  const meanSpacing = lineSpacings.reduce((sum, s) => sum + s, 0) / lineSpacings.length;
  const variance = lineSpacings.reduce((sum, s) => sum + Math.pow(s - meanSpacing, 2), 0) / lineSpacings.length;
  const stdDev = Math.sqrt(variance);
  const coefficientOfVariation = stdDev / meanSpacing;

  // 3. 变异系数越小，规律性越高
  const regularityScore = Math.max(0, 1 - coefficientOfVariation);
  
  return regularityScore;
}

/**
 * **功能 (What):** 检测页面是否为扫描件
 * **输入 (Input / @param):** 
 * @param page - PDF页面对象
 * **输出 (Output / @returns):** 是否为扫描件的概率（0-1）
 * **副作用 (Side-effects):** 无副作用，纯检测函数
 */
export async function detectScannedPage(page: any): Promise<number> {
  try {
    // 1. 检查是否有图像对象
    const ops = await page.getOperatorList();
    let hasImages = false;
    let imageCount = 0;

    for (const op of ops.argsArray) {
      if (op && op.length > 0 && typeof op[0] === 'string') {
        if (op[0].includes('Image') || op[0].includes('img')) {
          hasImages = true;
          imageCount++;
        }
      }
    }

    // 2. 获取文本内容
    const textContent = await page.getTextContent();
    const items = textContent.items as TextItem[];
    
    // 3. 计算文本密度
    const totalTextLength = items.reduce((sum, item) => sum + item.str.length, 0);
    const pageArea = page.view[2] * page.view[3]; // 页面面积
    const textDensity = totalTextLength / (pageArea / 1000); // 每1000平方像素的字符数

    // 4. 综合评估
    let scannedProbability = 0;

    // 如果有大量图像，可能是扫描件
    if (hasImages && imageCount > 0) {
      scannedProbability += 0.3;
    }

    // 如果文本密度很低，可能是扫描件
    if (textDensity < 0.1) {
      scannedProbability += 0.4;
    }

    // 如果文本项目很少但页面不是空白，可能是扫描件
    if (items.length < 20 && pageArea > 100000) {
      scannedProbability += 0.3;
    }

    return Math.min(scannedProbability, 1.0);

  } catch (error) {
    console.warn(`[LayoutAnalyzer] 扫描件检测失败:`, error);
    return 0; // 检测失败时假设不是扫描件
  }
} 