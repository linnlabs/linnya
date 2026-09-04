/**
 * @file src/parsers/pdfParser/strategies/TextExtractionStrategy.ts
 *
 * **功能 (What):** Layer 1 - 快速文本提取策略
 * **输入 (Input):** PDF二进制数据
 * **输出 (Output):** 处理结果
 * **副作用 (Side-effects):** 使用 PDF.js 解析 PDF
 */

import { ParsedBlock } from '../../types';
import { StrategyResult, TextItem } from '../types';
import { extractWithPdfJs, evaluateExtractionQuality } from '../adapters/PdfParseAdapter';
import { isLikelyMultiColumn } from '../utils/textProcessing';
import { convertTextToBlocks } from '../utils/dataConverters';

/**
 * **功能 (What):** Layer 1 - 尝试快速文本提取
 * **输入 (Input / @param):**
 * @param data - PDF文件的二进制数据
 * @param docId - 文档ID
 * **输出 (Output / @returns):** 提取结果
 * **副作用 (Side-effects):** 使用 PDF.js 处理 PDF
 */
export async function tryQuickTextExtraction(
  data: Uint8Array,
  docId: string
): Promise<StrategyResult> {
  try {
    console.log('[TextExtractionStrategy] 开始快速文本提取...');

    const pdfData = await extractWithPdfJs(data);

    // 评估提取质量
    const qualityResult = evaluateExtractionQuality(pdfData);
    console.log(
      `[TextExtractionStrategy] PDF.js 结果: ${pdfData.numpages}页, 文本密度: ${qualityResult.textDensity.toFixed(1)} 字符/页`
    );

    // 如果质量不好，返回失败
    if (!qualityResult.isGoodQuality) {
      return {
        success: false,
        error: qualityResult.reason,
      };
    }

    // 检查是否可能是多栏布局
    const multiColumnResult = isLikelyMultiColumn(pdfData.text);
    if (multiColumnResult) {
      console.log(`[TextExtractionStrategy] 多栏检测触发，文本样本:`);
      console.log(`[TextExtractionStrategy] 前200字符: "${pdfData.text.substring(0, 200)}..."`);
      return {
        success: false,
        error: '检测到可能的多栏布局，需要几何分析',
      };
    }

    // 🔥 核心修复：按页码重新组合文本并创建内容块
    const itemsByPage: { [page: number]: TextItem[] } = {};
    for (const item of pdfData.items) {
      const pageNum = item.page || 1; // 如果没有页码，默认为1
      if (!itemsByPage[pageNum]) {
        itemsByPage[pageNum] = [];
      }
      itemsByPage[pageNum].push(item);
    }

    let allBlocks: ParsedBlock[] = [];
    let blockIndex = 0;
    const sortedPages = Object.keys(itemsByPage)
      .map(Number)
      .sort((a, b) => a - b);

    for (const pageNum of sortedPages) {
      const pageItems = itemsByPage[pageNum];
      const pageText = pageItems.map(item => item.str).join(' ');

      const pageBlocks = convertTextToBlocks(pageText, docId, pageNum, blockIndex);
      allBlocks.push(...pageBlocks);
      blockIndex += pageBlocks.length;
    }

    console.log(`[TextExtractionStrategy] 快速文本提取成功，生成 ${allBlocks.length} 个块`);

    return {
      success: true,
      blocks: allBlocks,
    };
  } catch (error) {
    return {
      success: false,
      error: `PDF.js 处理失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * **功能 (What):** 验证文本提取结果的质量
 * **输入 (Input / @param):**
 * @param text - 提取的文本
 * @param pageCount - 页数
 * **输出 (Output / @returns):** 质量评估结果
 * **副作用 (Side-effects):** 无副作用，纯质量评估
 */
export function validateTextExtractionQuality(
  text: string,
  pageCount: number
): {
  isValid: boolean;
  textDensity: number;
  issues: string[];
} {
  const issues: string[] = [];
  const textDensity = text.length / pageCount;

  // 检查文本密度
  if (textDensity < 50) {
    issues.push(`文本密度过低 (${textDensity.toFixed(1)}字符/页)`);
  }

  // 检查是否有实际内容
  const meaningfulText = text.replace(/\s+/g, '').length;
  if (meaningfulText < 100) {
    issues.push('实际文本内容过少，可能是扫描件');
  }

  // 检查多栏布局特征
  if (isLikelyMultiColumn(text)) {
    issues.push('检测到多栏布局特征');
  }

  // 检查是否含有大量重复字符（可能是OCR错误）
  const uniqueChars = new Set(text.toLowerCase()).size;
  const totalChars = text.length;
  if (totalChars > 0 && uniqueChars / totalChars < 0.01) {
    issues.push('字符多样性过低，可能是OCR错误');
  }

  return {
    isValid: issues.length === 0,
    textDensity,
    issues,
  };
}

/**
 * **功能 (What):** 检查文本是否包含特定模式
 * **输入 (Input / @param):**
 * @param text - 文本内容
 * @param patterns - 要检查的模式数组
 * **输出 (Output / @returns):** 匹配的模式
 * **副作用 (Side-effects):** 无副作用，纯模式匹配
 */
export function detectTextPatterns(
  text: string,
  patterns: RegExp[] = []
): {
  hasAcademicPatterns: boolean;
  hasTablePatterns: boolean;
  hasMathPatterns: boolean;
  customMatches: RegExpMatchArray[];
} {
  // 学术论文模式
  const academicPatterns = [
    /abstract|introduction|methodology|conclusion|references/i,
    /figure\s+\d+|table\s+\d+/i,
    /\[\d+\]|\(\d{4}\)/, // 引用格式
  ];

  // 表格模式
  const tablePatterns = [
    /\|\s*[^\|]+\s*\|/, // 表格分隔符
    /\s{4,}\S+\s{4,}/, // 多个空格分隔的列
  ];

  // 数学公式模式
  const mathPatterns = [
    /\$[^$]+\$/, // LaTeX数学模式
    /\\begin\{[^}]+\}/, // LaTeX环境
    /\d+\.\d+|±|≤|≥|α|β|γ/, // 数学符号
  ];

  const hasAcademicPatterns = academicPatterns.some(pattern => pattern.test(text));
  const hasTablePatterns = tablePatterns.some(pattern => pattern.test(text));
  const hasMathPatterns = mathPatterns.some(pattern => pattern.test(text));

  const customMatches = patterns
    .map(pattern => text.match(pattern))
    .filter(Boolean) as RegExpMatchArray[];

  return {
    hasAcademicPatterns,
    hasTablePatterns,
    hasMathPatterns,
    customMatches,
  };
}
