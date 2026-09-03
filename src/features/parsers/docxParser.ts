/**
 * @file src/parsers/docxParser.ts
 *
 * **功能 (What):** DOCX文档解析器，负责将.docx文件解析为统一的结构化数据格式。
 *
 * **输入 (Input / @param):** 
 * @param data - 文档的二进制内容 (Uint8Array)
 * @param docId - 文档的唯一ID (string)
 * @param updater - 可选的进度更新器函数
 *
 * **输出 (Output / @returns):** 
 * 返回一个 Promise，解析为包含解析结果的 ParsedBlock 数组
 *
 * **副作用 (Side-effects):** 
 * 1. 使用 mammoth 库解析 DOCX 文件内容
 * 2. 通过 updater 函数更新解析进度
 * 3. 生成结构化的文档块数据
 *
 * @description
 * 该文件实现了对 DOCX 文件的解析功能，支持段落和表格内容的提取。
 * 它将文档内容转换为统一的 ParsedBlock 格式，保持文档的原始结构顺序。
 */

import mammoth from 'mammoth';
import { Parser, ParsedBlock, ProgressUpdater, generateBlockId } from './types';

/**
 * **功能 (What):** DOCX文件解析器类
 * **输入 (Input):** 实现 Parser 接口
 * **输出 (Output):** 提供 parse 方法来解析 DOCX 文件
 * **副作用 (Side-effects):** 无副作用，纯解析器
 */
export class DocxParser implements Parser {
  /**
   * **功能 (What):** 解析DOCX文件内容，支持段落和表格
   * **输入 (Input / @param):** 
   * @param data - 文件内容的 Uint8Array
   * @param docId - 文档的唯一ID  
   * @param updater - 进度更新器（可选）
   * **输出 (Output / @returns):** 解析后的 ParsedBlock 数组
   * **副作用 (Side-effects):** 
   * 1. 使用 mammoth 解析 DOCX 二进制数据
   * 2. 提取段落和表格内容
   * 3. 通过 updater 更新进度状态
   */
  async parse(data: Uint8Array, docId: string, updater?: ProgressUpdater): Promise<ParsedBlock[]> {
    if (updater) {
      updater(5, '开始解析DOCX文件...');
    }

    try {
      // 将 Uint8Array 转换为 Buffer (mammoth 需要 Buffer)
      const buffer = Buffer.from(data);
      
      if (updater) {
        updater(15, '正在提取文档结构...');
      }

      // 使用 mammoth 解析 DOCX 文件
      // 获取原始的文档元素以保持结构顺序
      const options = {
        convertImage: mammoth.images.imgElement(function(image) {
          // 返回Promise来忽略图片
          return Promise.resolve({ src: "", alt: "[图片已忽略]" });
        }),
        includeDefaultStyleMap: true
      };

      const result = await mammoth.convertToHtml({ buffer }, options);
      const htmlContent = result.value;
      const messages = result.messages;

      // 记录解析过程中的警告或错误
      if (messages.length > 0) {
        console.warn(`[DocxParser] 解析过程中的消息:`, messages);
      }

      if (updater) {
        updater(40, '正在分析文档内容...');
      }

      // 解析HTML内容并提取结构化数据
      const blocks = this.parseHtmlContent(htmlContent, docId);

      if (updater) {
        updater(80, '正在生成结构化数据...');
      }

      // 生成最终的 ParsedBlock 数组
      const parsedBlocks = blocks.map((block, index) => ({
        blockId: generateBlockId(docId, index, block.text),
        text: block.text,
        type: block.type,
        metadata: block.metadata
      }));

      if (updater) {
        updater(100, `DOCX文件解析完成，共生成 ${parsedBlocks.length} 个块`);
      }

      console.log(`[DocxParser] 成功解析DOCX文档: ${docId}, 生成 ${parsedBlocks.length} 个内容块`);
      return parsedBlocks;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      console.error(`[DocxParser] 解析DOCX文件失败:`, error);
      
      if (updater) {
        updater(100, `解析失败: ${errorMessage}`);
      }
      
      throw new Error(`Failed to parse DOCX file: ${errorMessage}`);
    }
  }

  /**
   * **功能 (What):** 解析HTML内容并提取段落和表格
   * **输入 (Input / @param):** 
   * @param htmlContent - mammoth 转换后的HTML内容
   * @param docId - 文档ID
   * **输出 (Output / @returns):** 包含结构化内容的对象数组
   * **副作用 (Side-effects):** 无副作用，纯解析函数
   */
  private parseHtmlContent(htmlContent: string, docId: string): Array<{
    text: string;
    type: 'paragraph' | 'table_row';
    metadata?: Record<string, unknown>;
  }> {
    const blocks: Array<{
      text: string;
      type: 'paragraph' | 'table_row';
      metadata?: Record<string, unknown>;
    }> = [];

    // 简单的HTML解析（这里可以使用更复杂的HTML解析器，如 jsdom）
    // 提取段落
    const paragraphMatches = htmlContent.match(/<p[^>]*>(.*?)<\/p>/gs) || [];
    paragraphMatches.forEach((match, index) => {
      const text = this.stripHtmlTags(match).trim();
      if (text.length > 0) {
        blocks.push({
          text,
          type: 'paragraph',
          metadata: {
            docId,
            page: 1, // DOCX文件默认认为都在第一页
            paraIdx: index + 1
          }
        });
      }
    });

    // 提取标题并当作段落处理
    const headingMatches = htmlContent.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gs) || [];
    headingMatches.forEach((match) => {
      const text = this.stripHtmlTags(match).trim();
      if (text.length > 0) {
        blocks.push({
          text,
          type: 'paragraph', // 标题也当作段落处理
          metadata: {
            docId,
            page: 1 // DOCX文件默认认为都在第一页
          }
        });
      }
    });

    // 提取表格
    const tableMatches = htmlContent.match(/<table[^>]*>(.*?)<\/table>/gs) || [];
    tableMatches.forEach((tableMatch, tableIndex) => {
      const rowMatches = tableMatch.match(/<tr[^>]*>(.*?)<\/tr>/gs) || [];
      
      rowMatches.forEach((rowMatch, rowIndex) => {
        const cellMatches = rowMatch.match(/<t[dh][^>]*>(.*?)<\/t[dh]>/gs) || [];
        const cellTexts = cellMatches.map(cell => this.stripHtmlTags(cell).trim());
        
        // 过滤空行
        if (cellTexts.some(cell => cell.length > 0)) {
          const rowText = cellTexts.join(' | ');
          
          blocks.push({
            text: rowText,
            type: 'table_row',
            metadata: {
              docId,
              sourceLocation: `Table ${tableIndex + 1}`,
              rowIdx: rowIndex + 1
            }
          });
        }
      });
    });

    return blocks;
  }

  /**
   * **功能 (What):** 移除HTML标签，保留纯文本内容
   * **输入 (Input / @param):** 
   * @param html - 包含HTML标签的字符串
   * **输出 (Output / @returns):** 移除标签后的纯文本
   * **副作用 (Side-effects):** 无副作用，纯文本处理函数
   */
  private stripHtmlTags(html: string): string {
    return html
      .replace(/<[^>]*>/g, '') // 移除所有HTML标签
      .replace(/&nbsp;/g, ' ') // 替换HTML实体
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' '); // 压缩多个空白字符为单个空格
  }
}
