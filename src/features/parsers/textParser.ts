/**
 * @file src/parsers/textParser.ts
 *
 * @brief 实现对纯文本文件（.txt, .md 等）的解析。
 *
 * @description
 * 该文件实现了对纯文本文件的解析功能。它将文本内容按段落
 * （由一个或多个空行分隔）进行分割，并将每个段落转换为一个
 * `ParsedBlock` 对象。
 */

import { Parser, ParsedBlock, ProgressUpdater, generateBlockId } from './types';

/**
 * 纯文本文件解析器
 */
export class TextParser implements Parser {
  /**
   * 解析纯文本文件内容
   * @param data 文件内容的 Uint8Array
   * @param docId 文档的唯一ID
   * @param updater 进度更新器
   * @returns 解析后的块数组
   */
  async parse(data: Uint8Array, docId: string, updater?: ProgressUpdater): Promise<ParsedBlock[]> {
    if (updater) {
      updater(10, '开始解析纯文本文件...');
    }

    try {
      const text = new TextDecoder('utf-8').decode(data);
      
      if (updater) {
        updater(50, '文本内容已解码，正在分块...');
      }
      
      // 按一个或多个空行分割段落
      const paragraphs = text.split(/\r?\n\s*\r?\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);

      const blocks: ParsedBlock[] = paragraphs
        .map((paragraph, index) => ({
          blockId: generateBlockId(docId, index, paragraph),
          text: paragraph,
          type: 'paragraph',
          metadata: {
            docId,
            page: 1, // 文本文件默认认为都在第一页
            paraIdx: index + 1
          }
        }));

      if (updater) {
        updater(100, '纯文本文件解析完成');
      }

      return blocks;
    } catch (error) {
      console.error('Error parsing text file:', error);
      if (updater) {
        updater(100, `解析失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
      throw new Error(`Failed to parse text file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
