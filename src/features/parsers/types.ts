/**
 * @file src/parsers/types.ts
 *
 * @brief [数据契约] 定义所有解析器（Parser）和其标准输出（ParsedBlock）的类型。
 *
 * @description
 * 该文件是解析器模块的数据契约，定义了所有解析器必须遵守的输入和输出格式。
 *
 * - `Parser` 接口：定义了所有解析器必须实现的 `parse` 方法。
 * - `ParsedBlock` 类型：定义了所有解析器输出的标准数据结构。
 * - `ParserOptions` 类型：定义了解析器可能需要的额外选项。
 */

export type BlockId = string;

/**
 * 解析器的进度更新器函数类型
 */
export type ProgressUpdater = (progress: number, message: string) => void;

/**
 * 解析器输出的标准数据块结构
 */
export interface ParsedBlock {
  /** 块的唯一ID，由解析器生成 */
  blockId: BlockId;
  
  /** 块的文本内容 */
  text: string;
  
  /** 块的类型（如段落、标题、列表项、表格行） */
  type: 'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'list_item' | 'table_row' | 'image';
  
  /** 块的元数据 */
  metadata?: Record<string, unknown>;

  /** 块的来源信息（例如页码、坐标等） */
  source_info?: SourceInfo;
}

export interface SourceInfo {
  page_number?: number;
  table_id?: string;
  row_idx?: number;
}

/**
 * 解析器函数的类型定义
 */
export type ParserFunction = (
  /** 文件内容的 Uint8Array */
  data: Uint8Array,
  /** 文档的唯一ID */
  docId: string,
  /** 进度更新器 */
  updater?: ProgressUpdater
) => Promise<ParsedBlock[]>;

/**
 * 解析器接口
 */
export interface Parser {
  /**
   * 解析文件内容
   * @param data 文件内容的 Uint8Array
   * @param docId 文档的唯一ID
   * @param updater 进度更新器
   * @returns 解析后的块数组
   */
  parse(data: Uint8Array, docId: string, updater?: ProgressUpdater): Promise<ParsedBlock[]>;
}

/**
 * 解析器选项
 */
export interface ParserOptions {
  /** 是否启用OCR */
  ocrEnabled?: boolean;
  /** OCR 模型的ID */
  ocrModelId?: string;
  /** 其他选项 */
  [key: string]: unknown;
}

/**
 * 生成块ID的函数
 * 使用shared模块的真正实现
 */
import { generateBlockId as _generateBlockId } from '@shared/utils/idUtils';

export function generateBlockId(docId: string, index: number, text: string): BlockId {
  return _generateBlockId(docId, index, text);
}
