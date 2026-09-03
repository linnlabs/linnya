/**
 * @file src/parsers/index.ts
 *
 * @brief [注册中心] 负责根据文件类型分发对应的解析器实例。
 *
 * @description
 * 该文件是解析器模块的入口点，它实现了一个策略模式，根据文件扩展名
 * 来选择合适的解析器。它还提供了一个统一的 `parse` 函数，可以自动
 * 处理任何支持的文件类型。
 */

import { Parser, ParsedBlock, ProgressUpdater } from './types';
import { TextParser } from './textParser';
import { DocxParser } from './docxParser';
import { ImageParser } from './imageParser';
import { createAutoPdfParser } from './pdfParser/factory';
import { XlsxParser } from './xlsxParser';
import { PptxParser } from './pptxParser';

/**
 * 解析器注册表
 * 将文件扩展名映射到对应的解析器实例
 */
const parserRegistry: Record<string, Parser> = {
  // 文本文档
  '.txt': new TextParser(),
  '.md': new TextParser(),
  '.markdown': new TextParser(),
  '.csv': new TextParser(),
  '.log': new TextParser(),
  
  // Word 文档
  '.docx': new DocxParser(),
  
  // PDF 文档 - 使用自动获取AI引擎的智能解析器
  '.pdf': createAutoPdfParser(),
  
  // 图像文件 - 自动使用AI引擎支持
  '.png': new ImageParser(),
  '.jpg': new ImageParser(),
  '.jpeg': new ImageParser(),
  '.webp': new ImageParser(),
  '.bmp': new ImageParser(),
  '.gif': new ImageParser(),
  
  // Excel 文档
  '.xlsx': new XlsxParser(),
  '.xls': new XlsxParser(),
  
  // PowerPoint 文档
  '.pptx': new PptxParser(),
  '.ppt': new PptxParser(),
};

/**
 * 根据文件扩展名获取解析器
 * @param extension 文件扩展名
 * @returns 对应的解析器实例，如果不支持则返回 null
 */
export function getParser(extension: string): Parser | null {
  return parserRegistry[extension.toLowerCase()] || null;
}

/**
 * 检查是否支持某个文件扩展名
 * @param extension 文件扩展名
 * @returns 如果支持则返回 true，否则返回 false
 */
export function isSupported(extension: string): boolean {
  return !!getParser(extension.toLowerCase());
}

/**
 * 统一的解析函数
 * @param filename 文件名
 * @param data 文件内容的 Uint8Array
 * @param docId 文档的唯一ID
 * @param updater 进度更新器
 * @returns 解析后的块数组
 */
export async function parse(
  filename: string,
  data: Uint8Array,
  docId: string,
  updater?: ProgressUpdater
): Promise<ParsedBlock[]> {
  const extension = '.' + filename.split('.').pop();
  const parser = getParser(extension);

  if (!parser) {
    throw new Error(`Unsupported file type: ${extension}`);
  }

  return parser.parse(data, docId, updater);
}

/**
 * 获取所有支持的文件扩展名
 * @returns 支持的文件扩展名数组
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(parserRegistry);
}

// 导出所有解析器类
export { TextParser, DocxParser, ImageParser, XlsxParser, PptxParser };

// 导出PDF解析器模块（供高级使用）
export * from './pdfParser';

// 导出图像解析器模块（供AI驱动使用）
export { parseImageWithAi } from './imageParser';

// 导出核心类型
export * from './types'; 