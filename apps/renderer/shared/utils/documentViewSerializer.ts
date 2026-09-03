/**
 * @file documentViewSerializer.ts
 * @description 从前端 ProseMirror Editor 生成 DocumentView 格式
 *
 * 本模块负责：
 * 1. 遍历 Editor 中的所有 rootBlock 节点
 * 2. 使用 markdownSerializer 将每个块序列化为 Markdown
 * 3. 生成 [#ref] 格式的正文（vNext 协议）
 *
 * 与后端 documentViewBuilder.ts 协议保持一致
 */

import type { Editor } from '@tiptap/core';
import { NodeFinder } from '../../domains/editor/extensions/position/NodeFinder';
import { createMarkdownSerializer } from './markdownSerializer';
import { generateRefId } from './refIdGenerator';

// 从共享 schemas 包导入类型和函数
import {
  type DocumentViewDocType,
  type DocumentViewMeta,
  DocumentBlockIdSchema,
  buildDocumentView as buildDocumentViewFromSchema
} from '../../../../packages/schemas/src/document-view';

// 重新导出类型供外部使用
export type { DocumentViewDocType, DocumentViewMeta };

/**
 * 展平后的单个块信息（前端版本，使用 markdown 字段名）
 */
export interface FlattenedBlock {
  index: number;
  blockId: string;
  markdown: string;
}

// ============================================================================
// 核心函数
// ============================================================================

// 创建 Markdown 序列化器实例
const markdownSerializer = createMarkdownSerializer({
  lineBreakStyle: 'standard'
});

function admitDocumentBlockId(
  value: unknown,
  index: number,
  admittedIds: Set<string>,
): string {
  const parsed = DocumentBlockIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Editor root block ${index} is missing its admitted block identity`);
  }
  if (admittedIds.has(parsed.data)) {
    throw new Error(`Editor root block ${index} repeats block identity ${parsed.data}`);
  }
  admittedIds.add(parsed.data);
  return parsed.data;
}

/**
 * 构建 DocumentView 文本（使用共享函数）
 */
export const buildDocumentView = buildDocumentViewFromSchema;

/**
 * 从展平的块列表构建正文（前端版本，使用 markdown 字段）
 *
 * 每个块格式化为 [#ref] 文本 的形式
 */
export async function buildBodyFromBlocks(blocks: FlattenedBlock[]): Promise<string> {
  const lines: string[] = [];
  for (const block of blocks) {
    /**
     * 中文说明（根因修复：必须保留 Markdown 的前导空白）
     *
     * 背景：
     * - DocumentView 的正文会直接喂给模型；
     * - Markdown 的“前导空格”在列表缩进、代码块、引用等场景是语义的一部分；
     * - 之前的 `.trim()` 会同时裁剪头尾空白，导致：
     *   - 列表层级丢失（变成同级）
     *   - 代码/引用结构错乱
     *   - 模型引用与编辑器真实结构脱节（表现为“引用系统只支持 markdown 文档，但不支持 Markdown 语法”）
     *
     * 结论：
     * - 只裁剪尾部空白（trimEnd），保留前导空格，保持结构稳定。
     */
    const trimmedMarkdown = block.markdown.trimEnd();
    const ref = await generateRefId(block.blockId);
    lines.push(`[${ref}] ${trimmedMarkdown}`);
  }
  return lines.join('\n\n');
}

// ============================================================================
// 从 Editor 序列化 DocumentView
// ============================================================================

/**
 * 序列化选项
 */
export interface SerializeDocumentViewOptions {
  /** 文档 ID（可选，如果不提供则使用占位符） */
  documentId?: string;

  /** 最大字符数限制（可选，默认不限制） */
  maxChars?: number;

  /** 起始偏移量（可选，默认 0） */
  offsetChars?: number;
}

/**
 * 序列化结果
 */
export interface SerializeDocumentViewResult {
  /** 完整的 DocumentView 文本 */
  documentViewText: string;

  /** 正文总长度 */
  totalTextLength: number;

  /** 是否因字符窗口裁剪而截断 */
  truncatedByChars: boolean;

  /** 下一次继续的偏移量 */
  nextOffset: number | null;
}

/**
 * 从 Tiptap Editor 序列化 DocumentView
 *
 * 遍历 Editor 中的所有 rootBlock 节点，将其序列化为统一的 DocumentView 格式。
 * 以 vNext 协议生成 DocumentView（[#ref] 文本），供 AI 精确定位块。
 *
 * @param editor - Tiptap 编辑器实例
 * @param options - 序列化选项
 * @returns 序列化结果，包含 DocumentView 文本和 snapshot entries
 *
 * @example
 * ```ts
 * const result = serializeDocumentViewFromEditor(editor, {
 *   documentId: 'doc-123',
 *   maxChars: 4000
 * });
 * // result.documentViewText 包含完整的 <workspace_document>...</workspace_document>
 * // result.documentViewText 包含完整的 <workspace_document>...</workspace_document>
 * ```
 */
export async function serializeDocumentViewFromEditor(
  editor: Editor,
  options: SerializeDocumentViewOptions = {}
): Promise<SerializeDocumentViewResult | null> {
  // 检查编辑器状态
  if (!editor || !editor.state) {
    console.warn('[documentViewSerializer] 编辑器实例或状态无效');
    return null;
  }

  const { documentId = 'unknown', maxChars, offsetChars = 0 } = options;

  // 使用 NodeFinder 获取所有 rootBlock 节点
  const finder = new NodeFinder(editor);
  const allRootBlocks = finder.findAllNodesOfType('rootBlock');

  if (allRootBlocks.length === 0) {
    console.warn('[documentViewSerializer] 未找到任何 rootBlock');
    return null;
  }

  // 步骤 1：展平所有 rootBlock，提取 blockId 和 Markdown 内容
  const flattenedBlocks: FlattenedBlock[] = [];
  const admittedIds = new Set<string>();

  for (let i = 0; i < allRootBlocks.length; i++) {
    const { node } = allRootBlocks[i];
    const blockId = admitDocumentBlockId(node.attrs?.id, i + 1, admittedIds);

    // 使用 markdownSerializer 序列化块内容
    const markdown = markdownSerializer.serialize(node);

    flattenedBlocks.push({
      index: i + 1, // index 从 1 开始
      blockId,
      markdown
    });
  }

  // 步骤 2：构建正文（[#ref] 格式）
  const fullBody = await buildBodyFromBlocks(flattenedBlocks);
  const totalTextLength = fullBody.length;

  // 步骤 3：处理窗口裁剪
  let bodyWindow = fullBody;
  let truncatedByChars = false;
  let nextOffset: number | null = null;

  if (maxChars !== undefined && maxChars > 0) {
    const safeOffset = Math.max(0, Math.min(offsetChars, totalTextLength));

    if (safeOffset >= totalTextLength) {
      bodyWindow = '';
    } else {
      const end = Math.min(safeOffset + maxChars, totalTextLength);
      bodyWindow = fullBody.slice(safeOffset, end);
      truncatedByChars = end < totalTextLength;
      nextOffset = truncatedByChars ? end : null;

      if (truncatedByChars) {
        bodyWindow += '... [truncated]';
      }
    }
  }

  // 步骤 4：组装 DocumentView 元数据
  const meta: DocumentViewMeta = {
    documentId,
    docType: 'markdown',
    offsetChars,
    truncatedByChars,
    totalTextLength,
    nextOffset
  };

  // 步骤 5：构建最终的 DocumentView 文本
  const documentViewText = buildDocumentView(meta, bodyWindow);

  return {
    documentViewText,
    totalTextLength,
    truncatedByChars,
    nextOffset
  };
}

/**
 * 仅获取块的 Markdown 内容列表（不构建完整 DocumentView）
 *
 * 用于需要单独获取块内容的场景
 *
 * @param editor - Tiptap 编辑器实例
 * @returns 展平后的块列表，或 null（如果编辑器无效）
 */
export function flattenBlocksFromEditor(editor: Editor): FlattenedBlock[] | null {
  if (!editor || !editor.state) {
    console.warn('[documentViewSerializer] 编辑器实例或状态无效');
    return null;
  }

  const finder = new NodeFinder(editor);
  const allRootBlocks = finder.findAllNodesOfType('rootBlock');

  if (allRootBlocks.length === 0) {
    return [];
  }

  const flattenedBlocks: FlattenedBlock[] = [];
  const admittedIds = new Set<string>();

  for (let i = 0; i < allRootBlocks.length; i++) {
    const { node } = allRootBlocks[i];
    const blockId = admitDocumentBlockId(node.attrs?.id, i + 1, admittedIds);
    const markdown = markdownSerializer.serialize(node);

    flattenedBlocks.push({
      index: i + 1,
      blockId,
      markdown
    });
  }

  return flattenedBlocks;
}
