/**
 * @file src/parsers/pdfParser/utils/dataConverters.ts
 * 
 * **功能 (What):** PDF解析器数据转换工具函数
 * **输入 (Input):** 原始数据或文本
 * **输出 (Output):** 转换后的ParsedBlock或结构化数据
 * **副作用 (Side-effects):** 无副作用，纯数据转换
 */

import { ParsedBlock, generateBlockId } from '../../types';
import { 
  cleanMarkdownContent, 
  cleanTextBlock, 
  isMarkdownTable, 
  processTableRow 
} from './textProcessing';

/**
 * **功能 (What):** 将文本转换为ParsedBlock格式
 * **输入 (Input / @param):** 
 * @param text - 文本内容
 * @param docId - 文档ID
 * @param pageNum - 页码（可选）
 * @param startIndex - 起始索引（可选）
 * **输出 (Output / @returns):** ParsedBlock数组
 * **副作用 (Side-effects):** 无副作用，纯数据转换
 */
export function convertTextToBlocks(
  text: string, 
  docId: string, 
  pageNum?: number, 
  startIndex: number = 0
): ParsedBlock[] {
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const blocks: ParsedBlock[] = [];

  paragraphs.forEach((paragraph, index) => {
    const cleanText = paragraph.trim().replace(/\s+/g, ' ');
    if (cleanText.length === 0) return;

    blocks.push({
      blockId: generateBlockId(docId, startIndex + index, cleanText),
      text: cleanText,
      type: 'paragraph',
      metadata: {
        docId,
        page: pageNum, // 确保页码信息被正确设置
        paraIdx: index + 1,
        extractionMethod: 'text'
      },
      source_info: pageNum ? {
        page_number: pageNum // 添加页码到source_info
      } : {}
    });
  });

  return blocks;
}

/**
 * **功能 (What):** 解析AI识别的Markdown内容为ParsedBlock
 * **输入 (Input / @param):** 
 * @param docId - 文档ID
 * @param pageNum - 页码
 * @param markdownContent - Markdown内容
 * **输出 (Output / @returns):** ParsedBlock数组
 * **副作用 (Side-effects):** 无副作用，纯数据转换
 */
export function parseMarkdownToBlocks(
  docId: string, 
  pageNum: number, 
  markdownContent: string,
  baseSourceInfo: Partial<ParsedBlock['source_info']> = {}, // 接受可选的source_info
  startIndex: number = 0 // ✅ 跨页稳定索引起点（避免不同页 blockId 冲突）
): ParsedBlock[] {
  const content = cleanMarkdownContent(markdownContent);
  const blocks = content.split(/\n\s*\n/);
  const processedBlocks: ParsedBlock[] = [];
  let blockIndex = startIndex;

  for (const blockText of blocks) {
    const cleanedText = cleanTextBlock(blockText);
    
    if (!cleanedText || cleanedText.startsWith('#')) {
      continue;
    }

    if (isMarkdownTable(cleanedText)) {
      // 处理表格
      const tableBlocks = parseTableToBlocks(
        cleanedText, 
        docId, 
        pageNum, 
        blockIndex,
        baseSourceInfo // 传递baseSourceInfo
      );
      processedBlocks.push(...tableBlocks);
      blockIndex += tableBlocks.length;
    } else {
      // 处理普通段落
      processedBlocks.push({
        blockId: generateBlockId(docId, blockIndex++, cleanedText),
        text: cleanedText,
        type: 'paragraph',
        metadata: {
          docId,
          page: pageNum, // 确保页码信息被正确设置
          // ✅ 与 blockIndex 保持一一对应：paraIdx 从 1 开始（更贴近阅读）
          paraIdx: (blockIndex - startIndex),
          extractionMethod: 'vision'
        },
        source_info: {
          ...baseSourceInfo, // 合并传入的source_info
          page_number: pageNum // 确保页码被设置
        }
      });
    }
  }

  return processedBlocks;
}

/**
 * **功能 (What):** 将表格文本转换为ParsedBlock数组
 * **输入 (Input / @param):** 
 * @param tableText - 表格文本
 * @param docId - 文档ID
 * @param pageNum - 页码
 * @param startIndex - 起始索引
 * **输出 (Output / @returns):** ParsedBlock数组
 * **副作用 (Side-effects):** 无副作用，纯数据转换
 */
function parseTableToBlocks(
  tableText: string, 
  docId: string, 
  pageNum: number, 
  startIndex: number,
  baseSourceInfo: Partial<ParsedBlock['source_info']> = {} // 接受可选的source_info
): ParsedBlock[] {
  const lines = tableText.split('\n');
  const blocks: ParsedBlock[] = [];
  let tableRowIndex = 1;
  let blockIndex = startIndex;

  for (const line of lines) {
    const result = processTableRow(line);
    if (!result) continue;

    const { rowText } = result;
    
    blocks.push({
      blockId: generateBlockId(docId, blockIndex++, rowText),
      text: rowText,
      type: 'table_row',
      metadata: {
        docId,
        page: pageNum, // 确保页码信息被正确设置
        sourceLocation: `Page ${pageNum}, Table ${Math.floor(blockIndex / 10) + 1}`,
        rowIdx: tableRowIndex++,
        extractionMethod: 'vision'
      },
      source_info: {
        ...baseSourceInfo, // 合并传入的source_info
        page_number: pageNum, // 确保页码被设置
        table_id: `table_${Math.floor(blockIndex / 10) + 1}`,
        row_idx: tableRowIndex - 1
      }
    });
  }

  return blocks;
} 