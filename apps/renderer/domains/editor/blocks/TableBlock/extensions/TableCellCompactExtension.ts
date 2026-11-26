import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  isCompactTableCellNode,
  WORKSPACE_TABLE_COMPACT_CELL_CLASS,
} from '@linnya/markdown-document-core/workspace-table';

export const tableCellCompactPluginKey = new PluginKey<DecorationSet>('tableCellCompact');

/** Workspace 正文合同的单元格节点名固定，与 Editor 注册表和后端 schema 一致。 */
function isTableCell(node: ProseMirrorNode): boolean {
  return node.type.name === 'tableCell' || node.type.name === 'tableHeader';
}

/** 一张表内所有短格的 decoration；判定与只读预览、PDF 共用 `isCompactTableCellNode`。 */
export function buildTableCompactDecorations(table: ProseMirrorNode, tablePos: number): Decoration[] {
  const decorations: Decoration[] = [];
  table.descendants((node, offset) => {
    if (!isTableCell(node)) return true;
    if (isCompactTableCellNode(node)) {
      const from = tablePos + 1 + offset;
      decorations.push(Decoration.node(from, from + node.nodeSize, { class: WORKSPACE_TABLE_COMPACT_CELL_CLASS }));
    }
    return false;
  });
  return decorations;
}

/** 只进入容器节点找表格，不遍历段落内的行内内容。 */
function collectTables(doc: ProseMirrorNode, from: number, to: number): Map<number, ProseMirrorNode> {
  const tables = new Map<number, ProseMirrorNode>();
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'table') {
      tables.set(pos, node);
      return false;
    }
    return !node.isTextblock && !node.isAtom;
  });
  return tables;
}

export function buildCompactDecorationSet(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  for (const [pos, table] of collectTables(doc, 0, doc.content.size)) {
    decorations.push(...buildTableCompactDecorations(table, pos));
  }
  return DecorationSet.create(doc, decorations);
}

/** 文档变化只重算被改动的表，其余 decoration 跟随映射。 */
export function updateCompactDecorationSet(previous: DecorationSet, tr: Transaction): DecorationSet {
  if (!tr.docChanged) return previous;
  const doc = tr.doc;
  const touched = new Map<number, ProseMirrorNode>();
  tr.mapping.maps.forEach((stepMap, index) => {
    const rest = tr.mapping.slice(index + 1);
    stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      const from = Math.max(0, rest.map(newStart, -1) - 1);
      const to = Math.min(doc.content.size, rest.map(newEnd, 1) + 1);
      for (const [pos, table] of collectTables(doc, from, to)) touched.set(pos, table);
    });
  });
  // prosemirror-state 与 prosemirror-view 解析到不同的 prosemirror-transform 版本，按 view 的 Mapping 重建一次。
  let next = previous.map(new Mapping(tr.mapping.maps), doc);
  for (const [pos, table] of touched) {
    next = next.remove(next.find(pos, pos + table.nodeSize));
    next = next.add(doc, buildTableCompactDecorations(table, pos));
  }
  return next;
}

/**
 * 短格不断行：单行、不超过 8em 的单元格加 `table-cell--compact`，样式归共用 workspace-table.css。
 * 用 decoration 而不是直接改 DOM：单元格在表格 contentDOM 内，直接写属性会被 ProseMirror 当作文档变化重新解析。
 */
export const TableCellCompactExtension = Extension.create({
  name: 'tableCellCompact',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: tableCellCompactPluginKey,
        state: {
          init: (_config, state) => buildCompactDecorationSet(state.doc),
          apply: (tr, previous) => updateCompactDecorationSet(previous, tr),
        },
        props: {
          decorations: state => tableCellCompactPluginKey.getState(state),
        },
      }),
    ];
  },
});
