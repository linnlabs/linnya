/**
 * @file blockEventToDocJson.ts
 * @description 将 WASM Markdown BlockEvent[] 转换为后端可落库的 doc JSON。
 */

import {
  generateEditorAnnotationId,
  generateEditorBlockId,
  generateEditorRootBlockId
} from 'src/shared/utils/idUtils';
import {
  admitMarkdownAnnotationComment,
  isMarkdownEmptyBlockAnnotationAnchorComment,
  MarkdownAnnotationsSchema,
  type MarkdownAnnotation,
} from '@app/schemas';
import type {
  MarkdownDocJson,
  ProseMirrorJsonNode,
  WasmBlockEventLike,
  WasmContentFragmentLike,
  WasmMarkLike
} from './types';

const SUPPORTED_MARK_TYPES = new Set(['bold', 'italic', 'strike', 'code', 'link']);

export type MarkdownAnnotationCommentAdmitter = (
  comment: string,
  targetRootBlockIndex: number,
) => MarkdownAnnotation;

const admitImportedAnnotationComment: MarkdownAnnotationCommentAdmitter = comment => (
  admitMarkdownAnnotationComment(comment, {
    id: generateEditorAnnotationId(),
    author: 'User',
    timestamp: new Date().toISOString(),
    meta: { source: 'manual' },
  })
);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toSupportedMarks(marks: WasmMarkLike[] | null | undefined): Array<{
  type: string;
  attrs?: Record<string, unknown>;
}> {
  if (!Array.isArray(marks) || marks.length === 0) {
    return [];
  }

  const result: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
  for (const mark of marks) {
    if (!mark || typeof mark.type !== 'string') continue;
    if (!SUPPORTED_MARK_TYPES.has(mark.type)) continue;
    result.push(
      isRecord(mark.attrs)
        ? { type: mark.type, attrs: mark.attrs }
        : { type: mark.type }
    );
  }
  return result;
}

function buildInlineNodes(
  structured: WasmContentFragmentLike[] | null | undefined,
  rawFallback: string | null | undefined
): ProseMirrorJsonNode[] {
  const inlineNodes: ProseMirrorJsonNode[] = [];

  if (Array.isArray(structured) && structured.length > 0) {
    for (const fragment of structured) {
      if (!fragment || typeof fragment !== 'object') continue;

      if (fragment.type === 'text') {
        const text = typeof fragment.text === 'string' ? fragment.text : '';
        if (!text) continue;
        const marks = toSupportedMarks(fragment.marks);
        inlineNodes.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text });
        continue;
      }

      if (fragment.type === 'inlineLatex') {
        const attrs = isRecord(fragment.attrs) ? fragment.attrs : {};
        const latexSource =
          typeof attrs.latexSource === 'string' ? attrs.latexSource : '';
        inlineNodes.push({
          type: 'inlineLatex',
          attrs: {
            id: generateEditorBlockId(),
            latexSource
          }
        });
        continue;
      }

      if (fragment.type === 'hardBreak') {
        const marks = toSupportedMarks(fragment.marks);
        inlineNodes.push(
          marks.length > 0 ? { type: 'hardBreak', marks } : { type: 'hardBreak' }
        );
      }
    }
  }

  if (inlineNodes.length === 0 && typeof rawFallback === 'string' && rawFallback.length > 0) {
    inlineNodes.push({ type: 'text', text: rawFallback });
  }

  return inlineNodes;
}

function buildRootBlock(inner: ProseMirrorJsonNode): ProseMirrorJsonNode {
  return {
    type: 'rootBlock',
    attrs: {
      id: generateEditorRootBlockId()
    },
    content: [inner]
  };
}

function buildTableRowsFromModel(model: UnknownRecord): ProseMirrorJsonNode[] {
  const rows: ProseMirrorJsonNode[] = [];
  const withHeaderRow = model.with_header_row === true;
  const header = readArray(model.header);
  const bodyRows = readArray(model.rows);

  const buildCellContentBlock = (cellValue: unknown): ProseMirrorJsonNode | null => {
    if (!isRecord(cellValue)) return null;
    const inlineNodes = buildInlineNodes(
      Array.isArray(cellValue.content) ? (cellValue.content as WasmContentFragmentLike[]) : null,
      null
    );
    return {
      type: 'tableCellContentBlock',
      attrs: {
        id: generateEditorBlockId(),
        blockType: 'tableCellContent'
      },
      content: inlineNodes
    };
  };

  if (withHeaderRow && header.length > 0) {
    const headerCells: ProseMirrorJsonNode[] = [];
    for (const headerCell of header) {
      const contentBlock = buildCellContentBlock(headerCell);
      if (!contentBlock) continue;
      headerCells.push({
        type: 'tableHeader',
        attrs: {
          colspan: 1,
          rowspan: 1,
          colwidth: null,
          style: null
        },
        content: [contentBlock]
      });
    }
    if (headerCells.length > 0) {
      rows.push({
        type: 'tableRow',
        content: headerCells
      });
    }
  }

  for (const bodyRow of bodyRows) {
    if (!isRecord(bodyRow)) continue;
    const cellValues = readArray(bodyRow.cells);
    const cells: ProseMirrorJsonNode[] = [];
    for (const cellValue of cellValues) {
      const contentBlock = buildCellContentBlock(cellValue);
      if (!contentBlock) continue;
      cells.push({
        type: 'tableCell',
        attrs: {
          colspan: 1,
          rowspan: 1,
          colwidth: null,
          style: null
        },
        content: [contentBlock]
      });
    }
    if (cells.length > 0) {
      rows.push({
        type: 'tableRow',
        content: cells
      });
    }
  }

  return rows;
}

function normalizeBlockTypeName(blockType: string): string {
  return blockType.trim();
}

/**
 * 将 BlockEvent 序列转换为后端 doc JSON。
 */
export function convertBlockEventsToDocJson(
  blockEvents: WasmBlockEventLike[],
  admitAnnotationComment: MarkdownAnnotationCommentAdmitter = admitImportedAnnotationComment,
): MarkdownDocJson | null {
  if (!Array.isArray(blockEvents) || blockEvents.length === 0) {
    return null;
  }

  const rootBlocks: ProseMirrorJsonNode[] = [];

  for (const event of blockEvents) {
    if (!event || typeof event.block_type !== 'string') continue;

    const blockTypeName = normalizeBlockTypeName(event.block_type);
    const rawFallback = typeof event.raw_content_fallback === 'string'
      ? event.raw_content_fallback
      : null;

    if (blockTypeName === 'HtmlComment') {
      if (rawFallback && isMarkdownEmptyBlockAnnotationAnchorComment(rawFallback)) {
        rootBlocks.push(buildRootBlock({
          type: 'baseBlock',
          attrs: {
            id: generateEditorBlockId(),
            blockType: 'base',
          },
          content: [],
        }));
        continue;
      }
      const target = rootBlocks[rootBlocks.length - 1];
      if (!target) {
        throw new Error('[MarkdownImport] Annotation comment 前没有可绑定的目标块');
      }
      if (!rawFallback) {
        throw new Error('[MarkdownImport] HtmlComment 缺少原始内容');
      }
      const previousAnnotations = MarkdownAnnotationsSchema.parse(
        target.attrs?.annotations ?? []
      );
      const annotation = admitAnnotationComment(rawFallback, rootBlocks.length - 1);
      target.attrs = {
        ...(target.attrs ?? {}),
        annotations: [...previousAnnotations, annotation],
      };
      continue;
    }

    if (blockTypeName === 'TableBlock' && isRecord(event.attrs)) {
      const tableRows = buildTableRowsFromModel(event.attrs);
      if (tableRows.length > 0) {
        rootBlocks.push(
          buildRootBlock({
            type: 'table',
            attrs: {
              id: generateEditorBlockId(),
              blockType: 'table',
              withHeaderRow: event.attrs.with_header_row === true
            },
            content: tableRows
          })
        );
        continue;
      }
    }

    if (blockTypeName === 'LatexBlock') {
      rootBlocks.push(
        buildRootBlock({
          type: 'latexBlock',
          attrs: {
            id: generateEditorBlockId(),
            blockType: 'latex',
            latexSource: rawFallback ?? ''
          }
        })
      );
      continue;
    }

    if (blockTypeName === 'HorizontalRuleBlock') {
      rootBlocks.push(
        buildRootBlock({
          type: 'horizontalRuleBlock',
          attrs: {
            id: generateEditorBlockId(),
            blockType: 'horizontalRule'
          }
        })
      );
      continue;
    }

    if (blockTypeName === 'CodeBlock') {
      const codeContent: ProseMirrorJsonNode[] =
        rawFallback && rawFallback.length > 0 ? [{ type: 'text', text: rawFallback }] : [];
      rootBlocks.push(
        buildRootBlock({
          type: 'codeBlock',
          attrs: {
            id: generateEditorBlockId(),
            blockType: 'code',
            language: typeof event.language === 'string' ? event.language : ''
          },
          content: codeContent
        })
      );
      continue;
    }

    const inlineNodes = buildInlineNodes(event.structured_content ?? null, rawFallback);

    if (blockTypeName === 'HeadingBlock') {
      const level = readNumber(event.level);
      rootBlocks.push(
        buildRootBlock({
          type: 'headingBlock',
          attrs: {
            id: generateEditorBlockId(),
            blockType: 'heading',
            level: level && level > 0 ? level : 1
          },
          content: inlineNodes
        })
      );
      continue;
    }

    if (blockTypeName === 'QuoteBlock') {
      rootBlocks.push(
        buildRootBlock({
          type: 'quoteBlock',
          attrs: {
            id: generateEditorBlockId(),
            blockType: 'quote'
          },
          content: inlineNodes
        })
      );
      continue;
    }

    if (blockTypeName === 'ListItemBlock') {
      const level = readNumber(event.list_level) ?? readNumber(event.level) ?? 0;
      rootBlocks.push(
        buildRootBlock({
          type: 'listItemBlock',
          attrs: {
            id: generateEditorBlockId(),
            blockType: 'listItem',
            listType: typeof event.list_type === 'string' ? event.list_type : 'bullet',
            level: Math.max(0, level)
          },
          content: inlineNodes
        })
      );
      continue;
    }

    rootBlocks.push(
      buildRootBlock({
        type: 'baseBlock',
        attrs: {
          id: generateEditorBlockId(),
          blockType: 'base'
        },
        content: inlineNodes
      })
    );
  }

  return rootBlocks.length > 0
    ? {
        type: 'doc',
        content: rootBlocks
      }
    : null;
}
