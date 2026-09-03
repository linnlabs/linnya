/**
 * @file document-view.ts
 * @description DocumentView 协议 - AI Edit 工具的核心上下文格式（前后端共享）
 *
 * 该模块定义了前端 Editor 与 Workspace document-read feature 共享的文档视图格式。
 * 无论上下文来自前端还是后端，发送给 AI 模型的文档内容都必须遵循此协议。
 *
 * 关键设计原则：
 * 1. 前后端统一格式；meta 中保留 source 字段（editor | tool）用于调试和工具调用，
 *    但**不再输出到发送给模型的文本正文中**，避免对模型理解造成噪音；
 * 2. markdown 文档正文按 [index] 分块展示，便于 AI 精确引用；
 * 3. 插件文档可用自己的 docType 输出大纲或其它稳定文本视图。
 */

import { z } from 'zod';

// ============================================================================
// 阶段 1：DocumentView 协议类型定义
// ============================================================================

/**
 * 文档类型。
 *
 * 中文说明：`markdown` 是平台内置文档类型；插件文档使用自己的 active document type。
 * 这里不能枚举官方插件，否则新插件接入 DocumentView 协议时还要回宿主 schema 改白名单。
 */
export const DocumentViewDocTypeSchema = z.string().trim().min(1);
export type DocumentViewDocType = z.infer<typeof DocumentViewDocTypeSchema>;

/**
 * DocumentView 中可被引用的稳定块身份。
 *
 * ID 由文档实体创建链负责分配；序列化和展示边界只能校验、透传，禁止修剪、
 * 按下标补造或换成短引用。短引用是 block ID 的派生展示值，不是第二身份。
 */
export const DocumentBlockIdSchema = z.string().min(1).refine(
  value => value.trim() === value,
  'document block id must not contain leading or trailing whitespace',
);
export type DocumentBlockId = z.infer<typeof DocumentBlockIdSchema>;

/**
 * DocumentView 头部元数据
 * 用于描述文档的基本信息和读取状态
 */
export const DocumentViewMetaSchema = z.object({
  /** 文档 ID（对应 workspace_nodes.id） */
  documentId: z.string(),

  /** 文档类型 */
  docType: DocumentViewDocTypeSchema,

  /** 本次窗口起始字符偏移量（0 基），用于分页读取大文档 */
  offsetChars: z.number().int().nonnegative(),

  /** 是否因字符窗口裁剪而截断 */
  truncatedByChars: z.boolean(),

  /** 整篇文档正文的总字符长度（未截断时的完整长度） */
  totalTextLength: z.number().int().nonnegative(),

  /** 下一次继续阅读的偏移量。如果 truncated_by_chars=false，则为 null */
  nextOffset: z.number().int().nonnegative().nullable(),

  /** 当前返回的块数量（可选，用于说明为片段） */
  blocksShown: z.number().int().nonnegative().optional(),

  /** 文档总块数量（可选，用于说明为片段） */
  blocksTotal: z.number().int().nonnegative().optional()
});
export type DocumentViewMeta = z.infer<typeof DocumentViewMetaSchema>;

// ============================================================================
// 辅助类型：展平后的块信息
// ============================================================================

/**
 * 展平后的单个块信息
 */
export const FlattenedBlockSchema = z.object({
  /** 当前视图中的全局块序号（从 1 开始，仅用于阅读顺序） */
  index: z.number().int().positive(),

  /** 文档实体拥有的稳定块 ID */
  blockId: DocumentBlockIdSchema,

  /** 短引用 ID（vNext 协议，6位Base62，例如 `#aZ3kP9`） */
  ref: z.string(),

  /** 块的文本内容（纯文本或 Markdown） */
  text: z.string()
});
export type FlattenedBlock = z.infer<typeof FlattenedBlockSchema>;

// ============================================================================
// 纯函数：DocumentView 构建与解析
// ============================================================================

/**
 * 构建 DocumentView 文本输出
 *
 * 将元数据和正文内容组装为标准的 XML 风格包装格式。
 * AI 模型识别此格式，可以正确解析文档信息和内容。
 *
 * @param meta - 文档元数据
 * @param body - 正文内容（对于 markdown 已按 [index] 格式组织）
 * @returns 完整的 DocumentView 文本字符串
 *
 * @example
 * ```
 * <workspace_document>
 * document_id: abc-123
 * doc_type: markdown
 * offset_chars: 0
 * truncated_by_chars: false
 * total_text_length: 1234
 * next_offset: null
 * ---
 * [1] 这是第一段内容...
 * [2] 这是第二段内容...
 * </workspace_document>
 * ```
 */
export function buildDocumentView(meta: DocumentViewMeta, body: string): string {
  // 组装头部字段，每行一个 key: value 对
  const headerLines = [
    `document_id: ${meta.documentId}`,
    `doc_type: ${meta.docType}`,
    `offset_chars: ${meta.offsetChars}`,
    `truncated_by_chars: ${meta.truncatedByChars}`,
    `total_text_length: ${meta.totalTextLength}`,
    `next_offset: ${meta.nextOffset === null ? 'null' : meta.nextOffset}`
  ];

  if (typeof meta.blocksShown === 'number') {
    headerLines.push(`blocks_shown: ${meta.blocksShown}`);
  }

  if (typeof meta.blocksTotal === 'number') {
    headerLines.push(`blocks_total: ${meta.blocksTotal}`);
  }

  // 使用 XML 风格标签包装，便于 AI 模型识别边界
  return [
    '<workspace_document>',
    ...headerLines,
    '---',
    body,
    '</workspace_document>'
  ].join('\n');
}

/**
 * 从展平的块列表构建 DocumentView 正文
 *
 * vNext 协议：使用 [#ref] 格式（短引用 ID）替代 [index]。
 * 多个块之间用空行分隔。
 * 对于多行内容的块，仅首行带有 [#ref] 前缀。
 *
 * @param blocks - 展平后的块列表
 * @returns 格式化后的正文字符串
 */
export function buildBodyFromBlocks(blocks: FlattenedBlock[]): string {
  return blocks
    .map((block) => {
      const trimmedText = block.text.trim();
      // vNext 协议：使用 [#ref]
      return `[${block.ref}] ${trimmedText}`;
    })
    .join('\n\n');
}

// ============================================================================
// 文本窗口裁剪工具
// ============================================================================

/**
 * 文本窗口裁剪结果
 */
export interface TextWindowResult {
  /** 裁剪后的文本 */
  text: string;

  /** 是否被截断 */
  truncated: boolean;

  /** 原始文本总长度 */
  totalLength: number;

  /** 下一次继续阅读的偏移量（如果未截断则为 null） */
  nextOffset: number | null;
}

/**
 * 从文本中裁剪指定窗口
 *
 * @param text - 原始文本
 * @param offset - 起始偏移量（字符位置）
 * @param maxChars - 最大字符数
 * @param addTruncatedSuffix - 是否在截断时添加提示后缀
 * @returns 裁剪结果
 */
export function sliceTextWindow(
  text: string,
  offset: number,
  maxChars: number,
  addTruncatedSuffix = true
): TextWindowResult {
  const totalLength = text.length;

  // 安全处理偏移量
  const safeOffset = Math.max(0, Math.min(offset, totalLength));

  // 如果偏移量已超出文本范围
  if (safeOffset >= totalLength) {
    return { text: '', truncated: false, totalLength, nextOffset: null };
  }

  // 计算窗口结束位置
  const end = Math.min(safeOffset + maxChars, totalLength);
  const windowText = text.slice(safeOffset, end);
  const truncated = end < totalLength;
  const nextOffset = truncated ? end : null;

  // 如果被截断且需要添加提示
  if (truncated && addTruncatedSuffix) {
    return {
      text: `${windowText}... [truncated]`,
      truncated: true,
      totalLength,
      nextOffset
    };
  }

  return { text: windowText, truncated, totalLength, nextOffset };
}
