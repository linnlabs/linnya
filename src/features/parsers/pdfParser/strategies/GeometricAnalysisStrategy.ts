/**
 * @file src/parsers/pdfParser/strategies/GeometricAnalysisStrategy.ts
 * 
 * **功能 (What):** Layer 2 - 几何分析策略，处理多栏布局
 * **输入 (Input):** PDF二进制数据和处理上下文
 * **输出 (Output):** 处理结果
 * **副作用 (Side-effects):** 使用pdfjs-dist进行详细布局分析
 */

import { StrategyResult, PageProcessingContext } from '../types';
import { loadPdfDocument, extractTextItemsFromPage } from '../adapters/PdfjsAdapter';
import { analyzePageLayout } from '../layout/LayoutAnalyzer';
import { extractTextDirect, extractTextWithXYCut } from '../layout/XYCutAlgorithm';
import { convertTextToBlocks } from '../utils/dataConverters';

/**
 * **功能 (What):** Layer 2 - 尝试几何分栏处理
 * **输入 (Input / @param):** 
 * @param data - PDF文件的二进制数据
 * @param docId - 文档ID
 * @param updater - 进度更新器
 * **输出 (Output / @returns):** 提取结果
 * **副作用 (Side-effects):** 使用pdfjs-dist进行详细布局分析
 */
export async function tryGeometricExtraction(
  data: Uint8Array, 
  docId: string, 
  updater?: (progress: number, message: string) => void
): Promise<StrategyResult> {
  try {
    console.log('[GeometricAnalysisStrategy] 开始几何分析...');
    
    // 使用pdfjs-dist进行详细分析
    const pdf = await loadPdfDocument(data);
    const allBlocks: any[] = [];
    let blockIdCounter = 0;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      if (updater) {
        updater(
          30 + ((pageNum - 1) / pdf.numPages) * 50,
          `分析第 ${pageNum}/${pdf.numPages} 页布局...`
        );
      }

      const page = await pdf.getPage(pageNum);
      
      // 分析页面布局复杂度
      const complexity = await analyzePageLayout(page);
      console.log(`[GeometricAnalysisStrategy] 页面 ${pageNum} 布局分析: ${complexity.strategy}, ${complexity.columnCount}栏, 置信度: ${complexity.confidence.toFixed(2)}`);

      // 根据复杂度选择处理策略
      let pageText: string;
      
      if (complexity.strategy === 'direct') {
        pageText = await extractTextDirect(page);
      } else if (complexity.strategy === 'geometric') {
        pageText = await extractTextWithXYCut(page, complexity.columnCount);
      } else {
        // 单页太复杂，整体降级到视觉处理
        return {
          success: false,
          error: `页面 ${pageNum} 布局过于复杂，需要视觉识别`
        };
      }

      // 转换为ParsedBlock
      const pageBlocks = convertTextToBlocks(pageText, docId, pageNum, blockIdCounter);
      allBlocks.push(...pageBlocks);
      blockIdCounter += pageBlocks.length;
    }

    console.log(`[GeometricAnalysisStrategy] 几何分析成功，生成 ${allBlocks.length} 个块`);

    return {
      success: true,
      blocks: allBlocks
    };

  } catch (error) {
    return {
      success: false,
      error: `pdfjs-dist处理失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * **功能 (What):** 处理单个页面的几何分析
 * **输入 (Input / @param):** 
 * @param page - PDF页面对象
 * @param context - 页面处理上下文
 * **输出 (Output / @returns):** 页面处理结果
 * **副作用 (Side-effects):** 分析页面布局并提取文本
 */
export async function processPageWithGeometry(
  page: any,
  context: PageProcessingContext
): Promise<{
  success: boolean;
  text?: string;
  blocks?: any[];
  layoutInfo?: any;
  error?: string;
}> {
  try {
    const { docId, pageNum } = context;
    
    // 分析页面布局
    const complexity = await analyzePageLayout(page);
    
    // 记录布局信息
    const layoutInfo = {
      strategy: complexity.strategy,
      columnCount: complexity.columnCount,
      confidence: complexity.confidence,
      textDensity: complexity.textDensity,
      xPeaks: complexity.xPeaks
    };

    // 根据分析结果选择提取策略
    let pageText: string;
    
    switch (complexity.strategy) {
      case 'direct':
        pageText = await extractTextDirect(page);
        break;
        
      case 'geometric':
        pageText = await extractTextWithXYCut(page, complexity.columnCount);
        break;
        
      default:
        return {
          success: false,
          layoutInfo,
          error: `页面 ${pageNum} 需要视觉识别处理`
        };
    }

    // 转换为结构化块
    const blocks = convertTextToBlocks(pageText, docId, pageNum);

    return {
      success: true,
      text: pageText,
      blocks,
      layoutInfo
    };

  } catch (error) {
    return {
      success: false,
      error: `页面几何分析失败: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * **功能 (What):** 评估几何分析的质量
 * **输入 (Input / @param):** 
 * @param results - 页面处理结果数组
 * **输出 (Output / @returns):** 质量评估结果
 * **副作用 (Side-effects):** 无副作用，纯质量评估
 */
export function evaluateGeometricQuality(
  results: Array<{
    success: boolean;
    layoutInfo?: any;
    text?: string;
    error?: string;
  }>
): {
  overallQuality: number;
  successRate: number;
  averageConfidence: number;
  issues: string[];
} {
  const issues: string[] = [];
  const successfulPages = results.filter(r => r.success);
  const successRate = successfulPages.length / results.length;

  // 计算平均置信度
  const confidences = successfulPages
    .map(r => r.layoutInfo?.confidence || 0)
    .filter(c => c > 0);
  const averageConfidence = confidences.length > 0 
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length 
    : 0;

  // 检查文本质量
  let totalTextLength = 0;
  let pageCount = 0;
  
  successfulPages.forEach(result => {
    if (result.text) {
      totalTextLength += result.text.length;
      pageCount++;
    }
  });

  const averageTextDensity = pageCount > 0 ? totalTextLength / pageCount : 0;

  // 质量检查
  if (successRate < 0.8) {
    issues.push(`成功率过低: ${(successRate * 100).toFixed(1)}%`);
  }

  if (averageConfidence < 0.6) {
    issues.push(`平均置信度过低: ${(averageConfidence * 100).toFixed(1)}%`);
  }

  if (averageTextDensity < 200) {
    issues.push(`平均文本密度过低: ${averageTextDensity.toFixed(1)} 字符/页`);
  }

  // 计算综合质量分数
  const overallQuality = (successRate * 0.4 + averageConfidence * 0.4 + Math.min(averageTextDensity / 500, 1) * 0.2);

  return {
    overallQuality,
    successRate,
    averageConfidence,
    issues
  };
}

/**
 * **功能 (What):** 优化几何分析参数
 * **输入 (Input / @param):** 
 * @param layoutInfos - 布局信息数组
 * **输出 (Output / @returns):** 优化建议
 * **副作用 (Side-effects):** 无副作用，纯分析函数
 */
export function optimizeGeometricParameters(
  layoutInfos: Array<{
    columnCount: number;
    confidence: number;
    textDensity: number;
    xPeaks: number[];
  }>
): {
  recommendedBinSize: number;
  recommendedThreshold: number;
  columnDistribution: { [key: number]: number };
  suggestions: string[];
} {
  const suggestions: string[] = [];
  
  // 统计栏数分布
  const columnDistribution: { [key: number]: number } = {};
  layoutInfos.forEach(info => {
    columnDistribution[info.columnCount] = (columnDistribution[info.columnCount] || 0) + 1;
  });

  // 分析峰值间距
  const allGaps: number[] = [];
  layoutInfos.forEach(info => {
    if (info.xPeaks.length > 1) {
      for (let i = 1; i < info.xPeaks.length; i++) {
        allGaps.push(info.xPeaks[i] - info.xPeaks[i - 1]);
      }
    }
  });

  // 推荐参数
  let recommendedBinSize = 10; // 默认值
  let recommendedThreshold = 3; // 默认值

  if (allGaps.length > 0) {
    const avgGap = allGaps.reduce((sum, gap) => sum + gap, 0) / allGaps.length;
    // 基于平均间距调整分箱大小
    recommendedBinSize = Math.max(5, Math.min(20, Math.round(avgGap / 20)));
  }

  // 基于文本密度调整阈值
  const avgTextDensity = layoutInfos.reduce((sum, info) => sum + info.textDensity, 0) / layoutInfos.length;
  if (avgTextDensity > 1000) {
    recommendedThreshold = 5; // 高密度文本，提高阈值
    suggestions.push('检测到高密度文本，建议提高峰值检测阈值');
  } else if (avgTextDensity < 200) {
    recommendedThreshold = 2; // 低密度文本，降低阈值
    suggestions.push('检测到低密度文本，建议降低峰值检测阈值');
  }

  // 检查是否有过多的复杂页面
  const complexPages = layoutInfos.filter(info => info.columnCount > 3).length;
  if (complexPages / layoutInfos.length > 0.3) {
    suggestions.push('检测到过多复杂布局页面，建议降级到视觉识别');
  }

  return {
    recommendedBinSize,
    recommendedThreshold,
    columnDistribution,
    suggestions
  };
} 