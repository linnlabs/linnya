/**
 * @file src/knowledge-base/domain/block.ts
 *
 * @brief 定义知识库的块结构和Source of Truth数据结构
 *
 * @description
 * 这个文件定义了知识库中存储文档内容的块结构类型系统。块是知识库中的最小内容单元，
 * 每个文档由多个块组成，包括段落、表格、标题等。Source of Truth (SoT) 结构定义了
 * 文档的完整内容，包括块结构和文档元数据。
 * `DocumentSoTSchema` 是当前 JSON 持久化合同；摄入、续跑与读取必须共同遵守。
 */

import { z } from 'zod';
import { Document } from './document';
import { generateBlockId as generateDeterministicBlockId } from 'src/shared/utils/idUtils';

/**
 * 块类型枚举
 */
export enum BlockType {
  PARAGRAPH = 'paragraph',
  HEADING = 'heading',
  TABLE_ROW = 'table_row',
  LIST_ITEM = 'list_item',
  IMAGE = 'image',
  CODE = 'code'
}

/**
 * SoT 块的来源信息结构
 */
export const SourceInfoSchema = z.object({
  /** 页码 - 🔥 新规范：统一使用 page_num */
  page_num: z.number().optional(),
  
  /** 段落索引 */
  para_idx: z.number().optional(),
  
  /** 历史 SoT 兼容字段；新写入优先使用 page_num。 */
  page_number: z.number().optional(),
  
  /** (未来使用) 源位置 */
  source_location: z.unknown().optional().nullable(),
  
  /** 表格ID (用于关联表格行) */
  table_id: z.string().optional(),

  /** 行索引 (用于表格内排序) */
  row_idx: z.number().optional(),

  /** 块在页面上的位置信息 (用于排序) */
  position: z.object({
    y: z.number()
  }).passthrough().optional(),
});

/**
 * 块基础结构的 Zod schema
 */
export const BaseBlockSchema = z.object({
  /** 当前 SoT 持久化字段名 */
  block_type: z.nativeEnum(BlockType),
  
  /** 当前 SoT 持久化字段名 */
  text: z.string(),

  /** 标题/列表层级 */
  level: z.number().nullable().optional(),
  
  /** 来源信息 */
  source_info: SourceInfoSchema.optional(),

  /**
   * 可选：拆分块的父子关系（Phase 1 引入，用于调试/聚合）
   * - parent_block_id：父块 ID
   * - part_index：子块序号（从 0 开始）
   */
  parent_block_id: z.string().optional(),
  part_index: z.number().int().nonnegative().optional(),
});

/**
 * 段落块的Zod模式
 */
export const ParagraphBlockSchema = BaseBlockSchema.extend({
  block_type: z.literal(BlockType.PARAGRAPH)
});

/**
 * 标题块的 Zod schema
 */
export const HeadingBlockSchema = BaseBlockSchema.extend({
  block_type: z.literal(BlockType.HEADING),
  level: z.number().min(1).max(6).nullable() // 允许为null
});

/**
 * 表格行块的Zod模式
 */
export const TableRowBlockSchema = BaseBlockSchema.extend({
  block_type: z.literal(BlockType.TABLE_ROW),
  cells: z.array(z.string()).optional()
});

/**
 * 列表项块的Zod模式
 */
export const ListItemBlockSchema = BaseBlockSchema.extend({
  block_type: z.literal(BlockType.LIST_ITEM),
  level: z.number().optional()
});

/**
 * 图片块的Zod模式
 */
export const ImageBlockSchema = BaseBlockSchema.extend({
  block_type: z.literal(BlockType.IMAGE),
  image_url: z.string().optional(),
  alt_text: z.string().optional()
});

/**
 * 代码块的Zod模式
 */
export const CodeBlockSchema = BaseBlockSchema.extend({
  block_type: z.literal(BlockType.CODE),
  language: z.string().optional()
});

/**
 * 通用块模式 - 支持所有块类型
 */
export const BlockSchema = z.discriminatedUnion('block_type', [
  ParagraphBlockSchema,
  HeadingBlockSchema,
  TableRowBlockSchema,
  ListItemBlockSchema,
  ImageBlockSchema,
  CodeBlockSchema
]);

/**
 * 块类型定义
 */
export type SourceInfo = z.infer<typeof SourceInfoSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type ParagraphBlock = z.infer<typeof ParagraphBlockSchema>;
export type HeadingBlock = z.infer<typeof HeadingBlockSchema>;
export type TableRowBlock = z.infer<typeof TableRowBlockSchema>;
export type ListItemBlock = z.infer<typeof ListItemBlockSchema>;
export type ImageBlock = z.infer<typeof ImageBlockSchema>;
export type CodeBlock = z.infer<typeof CodeBlockSchema>;

/**
 * 文档 Source of Truth 的权威 Zod schema
 */
export const DocumentSoTSchema = z.object({
  /** 文档ID */
  doc_id: z.string(),
  
  /** 文档标题 */
  doc_title: z.string(),
  
  /** 文档元数据 */
  metadata: z.object({
    /** 原始文件名 */
    source_file: z.string().optional(),
    
    /** (兼容) 原始文件路径 */
    source_file_path: z.string().optional(),
    
    /** 解析时间 */
    parsed_at: z.string().datetime().optional(),
    
    /** (兼容) 创建时间戳 */
    created_at: z.number().optional(),
    
    /** 解析器版本 */
    parser_version: z.string().optional(),
    
    /** 文件大小 */
    file_size: z.number().optional(),
    
    /** 页数 */
    page_count: z.number().optional(),
    
    /** MIME类型 */
    mime_type: z.string().optional(),
    
    /** 摄入时间戳 */
    ingestion_timestamp: z.number().optional(),
    
    /** 任务ID */
    task_id: z.string().optional(),
    
    /** 向量模型 */
    vector_model: z.string().optional(),
    
    /** 视觉模型 */
    vision_model: z.string().optional()
  }),
  
  /** 内容块映射 - key为block_id，value为块对象 */
  content_blocks: z.record(z.string(), BlockSchema),
  
  /** 文档结构 */
  structure: z.object({
    /** 根节点包含的块ID列表，按原始文档顺序排列 */
    root: z.array(z.string()),
    /**
     * 目录结构（可选）
     *
     * 说明：
     * - 当前后处理器会生成 toc，用于未来 UI/导航能力
     * - SoT 的核心可用性只依赖 root，因此 toc 允许缺失以兼容历史数据
     */
    toc: z.array(z.unknown()).optional()
  })
});

/**
 * 文档结构类型（Source of Truth）
 */
export type DocumentSoT = z.infer<typeof DocumentSoTSchema>;

/**
 * 创建符合当前持久化合同的 Source of Truth 结构
 * @param doc 文档实体
 * @param blocks 内容块列表
 * @param pageCount 页数
 * @param mimeType MIME类型
 * @param parserVersion 解析器版本
 * @returns 文档SoT结构
 */
export function createDocumentSoT(
  doc: Document,
  blocks: Block[],
  pageCount?: number,
  mimeType?: string,
  parserVersion: string = '2.1.0'
): DocumentSoT {
  // 创建块的映射 - 使用block_id作为key
  const contentBlocks: Record<string, Block> = {};
  const rootIds: string[] = [];
  
  /**
   * 重要说明（稳定性约束）：
   * - SoT 的 key 是 block_id，必须稳定且唯一；
   * - 同时要满足 Qdrant point id 的约束：UUID / 无符号整数；
   * - 因此这里禁止使用 Math.random() 等随机方案。
   *
   * 当前实现与摄入后处理器对齐：
   * - 使用中心化 idUtils.generateBlockId()（UUIDv5）生成确定性 block_id；
   * - 对文本做统一处理：末尾补一个换行符，便于模型理解块边界（与 postprocessor 约定一致）。
   */
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const textWithNewline = block.text.endsWith('\n') ? block.text : `${block.text}\n`;
    const blockId = generateDeterministicBlockId(doc.id, i, textWithNewline);
    const blockForSot: Block = { ...block, text: textWithNewline };
    contentBlocks[blockId] = blockForSot;
    rootIds.push(blockId);
  }
  
  return {
    doc_id: doc.id,
    doc_title: doc.filename,
    metadata: {
      source_file: doc.filename,
      parsed_at: new Date().toISOString(),
      parser_version: parserVersion,
      file_size: doc.fileSize,
      page_count: pageCount,
      mime_type: mimeType
    },
    content_blocks: contentBlocks,
    structure: {
      root: rootIds
    }
  };
}
