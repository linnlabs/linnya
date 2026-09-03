/**
 * @file src/parsers/pdfParser/utils/textProcessing.ts
 * 
 * **功能 (What):** PDF解析器文本处理工具函数
 * **输入 (Input):** 文本内容
 * **输出 (Output):** 处理后的文本或检测结果
 * **副作用 (Side-effects):** 无副作用，纯文本处理
 */

import { calculateVariance } from './mathUtils';

/**
 * **功能 (What):** 检查是否可能是多栏布局
 * **输入 (Input / @param):** 
 * @param text - 提取的文本
 * **输出 (Output / @returns):** 是否可能是多栏
 * **副作用 (Side-effects):** 无副作用，纯判断函数
 */
export function isLikelyMultiColumn(text: string): boolean {
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  
  // 🔥 基础信息统计
  const avgLineLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
  const lineLengths = lines.map(line => line.length);
  const variance = calculateVariance(lineLengths);
  const totalChars = text.length;
  
  console.log(`[多栏检测] 文档统计: 总字符=${totalChars}, 总行数=${lines.length}, 平均行长=${avgLineLength.toFixed(1)}字符/行, 方差=${variance.toFixed(1)}`);
  
  // 🔥 改进的多栏检测逻辑
  
  // 1. 如果文档内容足够丰富，降低误判概率
  if (totalChars > 3000) {
    console.log(`[多栏检测] 文档内容丰富(${totalChars}字符)，提高检测阈值`);
    
    // 对于长文档，使用更严格的标准
    if (avgLineLength < 25 && variance > 2000) {
      console.log(`[多栏检测] ✓ 长文档多栏特征: 极短行长(${avgLineLength.toFixed(1)} < 25) + 高方差(${variance.toFixed(1)} > 2000)`);
      return true;
    }
  } else {
    // 对于短文档，使用原有标准但稍微放宽
    if (avgLineLength < 30) {
      console.log(`[多栏检测] ✓ 短文档多栏特征: 行长过短(${avgLineLength.toFixed(1)} < 30字符/行)`);
      return true;
    }
  }

  // 2. 检查行长度变化（方差）- 统一标准
  if (variance > 1500) {
    console.log(`[多栏检测] ✓ 检测到多栏特征: 行长度变化过大(variance=${variance.toFixed(1)} > 1500)`);
    return true;
  }

  // 3. 组合检测：中等行长 + 高方差可能是多栏切换
  if (avgLineLength < 50 && variance > 800 && lines.length > 20) {
    console.log(`[多栏检测] ✓ 组合特征: 中等行长(${avgLineLength.toFixed(1)} < 50) + 方差(${variance.toFixed(1)} > 800) + 足够行数(${lines.length} > 20)`);
    return true;
  }

  console.log(`[多栏检测] ✗ 未检测到多栏特征，判定为单栏布局`);
  return false;
}

/**
 * **功能 (What):** 清理Markdown内容
 * **输入 (Input / @param):** 
 * @param content - 原始Markdown内容
 * **输出 (Output / @returns):** 清理后的内容
 * **副作用 (Side-effects):** 无副作用，纯文本处理
 */
export function cleanMarkdownContent(content: string): string {
  let cleaned = content.trim();
  
  // 移除可能包裹整个响应的markdown代码块
  if (cleaned.startsWith("```markdown")) {
    cleaned = cleaned.replace(/^```markdown\s*/, '').trim();
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.replace(/\s*```$/, '').trim();
  }
  
  return cleaned;
}

/**
 * **功能 (What):** 清理文本块内容
 * **输入 (Input / @param):** 
 * @param text - 原始文本块
 * **输出 (Output / @returns):** 清理后的文本
 * **副作用 (Side-effects):** 无副作用，纯文本处理
 */
export function cleanTextBlock(text: string): string {
  return text.trim()
    .replace(/\$/g, '') // 移除行内数学符号
    .replace(/\\mathbf|\\mathrm|\\begin\{aligned\}|\\end\{aligned\}/g, '') // 移除LaTeX命令
    .replace(/\\/g, ''); // 移除转义斜杠
}

/**
 * **功能 (What):** 检查是否为Markdown表格
 * **输入 (Input / @param):** 
 * @param text - 文本内容
 * **输出 (Output / @returns):** 是否为表格
 * **副作用 (Side-effects):** 无副作用，纯检查函数
 */
export function isMarkdownTable(text: string): boolean {
  const lines = text.split('\n');
  return lines.length > 1 && 
         lines.some(line => line.includes('---')) && 
         lines.filter(line => !line.includes('---')).every(line => line.includes('|'));
}

/**
 * **功能 (What):** 处理表格行
 * **输入 (Input / @param):** 
 * @param line - 表格行文本
 * **输出 (Output / @returns):** 处理后的单元格数组和行文本
 * **副作用 (Side-effects):** 无副作用，纯文本处理
 */
export function processTableRow(line: string): { cells: string[]; rowText: string } | null {
  const trimmedLine = line.trim();
  if (trimmedLine.includes('---') || !trimmedLine) {
    return null;
  }

  let processedLine = trimmedLine;
  if (processedLine.startsWith('|')) processedLine = processedLine.substring(1);
  if (processedLine.endsWith('|')) processedLine = processedLine.slice(0, -1);

  const cells = processedLine.split('|').map(c => c.trim());
  if (!cells.some(cell => cell.length > 0)) {
    return null;
  }

  const rowText = cells.join(' | ');
  return { cells, rowText };
}

/**
 * **功能 (What):** 睡眠指定时间
 * **输入 (Input / @param):** 
 * @param ms - 睡眠时间（毫秒）
 * **输出 (Output):** Promise
 * **副作用 (Side-effects):** 阻塞执行指定时间
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
} 