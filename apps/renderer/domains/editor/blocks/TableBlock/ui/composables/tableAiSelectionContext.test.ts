// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { CellSelection } from '@tiptap/pm/tables';
import { describe, expect, it } from 'vitest';
import {
  adjustTableRectForColumnInsertion,
  correctRectsAfterOutputColumnInsertion,
  createOutputColumnConfig,
  resolveTableAiSelectionContext,
  type OutputColumnConfig,
} from './tableAiSelectionContext';
import type { TableInfo, TableRect } from './types/tableAiTypes';

const schema = new Schema({
  nodes: {
    doc: { content: 'rootBlock+' },
    text: { group: 'inline' },
    rootBlock: {
      group: 'block',
      attrs: { id: { default: null } },
      content: 'table',
      toDOM: (node) => ['div', { 'data-id': node.attrs.id }, 0],
      parseDOM: [{ tag: 'div[data-id]' }],
    },
    table: {
      group: 'block',
      content: 'tableRow+',
      tableRole: 'table',
      toDOM: () => ['table', ['tbody', 0]],
      parseDOM: [{ tag: 'table' }],
    },
    tableRow: {
      content: 'tableCell+',
      tableRole: 'row',
      toDOM: () => ['tr', 0],
      parseDOM: [{ tag: 'tr' }],
    },
    tableCell: {
      content: 'tableCellContentBlock',
      tableRole: 'cell',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        colwidth: { default: null },
      },
      toDOM: () => ['td', 0],
      parseDOM: [{ tag: 'td' }],
    },
    tableCellContentBlock: {
      content: 'text*',
      toDOM: () => ['div', 0],
      parseDOM: [{ tag: 'div' }],
    },
  },
});

function createCell(text: string) {
  return schema.nodes.tableCell.create(
    null,
    schema.nodes.tableCellContentBlock.create(null, schema.text(text))
  );
}

function createRootBlock(rows: string[][], id = 'root-table') {
  const tableRows = rows.map((row) => schema.nodes.tableRow.create(null, row.map(createCell)));
  const table = schema.nodes.table.create(null, tableRows);
  return schema.nodes.rootBlock.create({ id }, table);
}

function createDoc(rows: string[][]) {
  return schema.nodes.doc.create(null, [createRootBlock(rows)]);
}

function findTablePos(state: EditorState): number {
  let tablePos: number | null = null;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table' || tablePos !== null) return true;
    tablePos = pos;
    return false;
  });

  if (tablePos === null) {
    throw new Error('测试文档缺少 table');
  }

  return tablePos;
}

function findTablePosByRootBlockId(state: EditorState, rootBlockId: string): number {
  let tablePos: number | null = null;

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'rootBlock' || node.attrs.id !== rootBlockId) return true;
    node.descendants((child, relativePos) => {
      if (tablePos !== null) return false;
      if (child.type.name !== 'table') return true;
      tablePos = pos + 1 + relativePos;
      return false;
    });
    return false;
  });

  if (tablePos === null) {
    throw new Error(`测试文档缺少 table: ${rootBlockId}`);
  }

  return tablePos;
}

function createState(rows: string[][]): EditorState {
  return EditorState.create({ schema, doc: createDoc(rows) });
}

describe('tableAiSelectionContext', () => {
  it('resolves current CellSelection into a fresh table context', () => {
    let state = createState([
      ['a1', 'b1'],
      ['a2', 'b2'],
    ]);
    state = state.apply(state.tr.setSelection(CellSelection.create(state.doc, 3, 9)));

    const result = resolveTableAiSelectionContext({
      state,
      selection: state.selection,
      savedTableInfo: null,
      savedRect: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.source).toBe('current-selection');
    expect(result.context.tableInfo.pos).toBe(findTablePos(state));
    expect(result.context.tableInfo.node).toBe(state.doc.nodeAt(result.context.tableInfo.pos));
    expect(result.context.tableInfo.rootBlockId).toBe('root-table');
    expect(result.context.rect).toEqual({ top: 0, bottom: 1, left: 0, right: 2 });
    expect(result.context.selection).toBeInstanceOf(CellSelection);
  });

  it('uses saved context only when the saved table position is still valid in the latest doc', () => {
    const oldState = createState([['old']]);
    const latestState = createState([
      ['a1', 'b1'],
      ['a2', 'b2'],
    ]);
    const tablePos = findTablePos(latestState);
    const savedTableInfo: TableInfo = {
      node: oldState.doc.nodeAt(findTablePos(oldState))!,
      pos: tablePos,
    };
    const savedRect: TableRect = { top: 0, bottom: 2, left: 0, right: 1 };
    const selection = TextSelection.create(latestState.doc, 5);

    const result = resolveTableAiSelectionContext({
      state: latestState,
      selection,
      savedTableInfo,
      savedRect,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.source).toBe('saved-context');
    expect(result.context.tableNode).toBe(latestState.doc.nodeAt(tablePos));
    expect(result.context.tableInfo.node).toBe(latestState.doc.nodeAt(tablePos));
    expect(result.context.tableInfo.rootBlockId).toBe('root-table');
    expect(result.context.rect).toEqual(savedRect);
    expect(result.context.selection).toBeNull();
  });

  it('refreshes saved table context by rootBlock id when its old position drifted', () => {
    const oldState = createState([['old']]);
    const staleTablePos = findTablePos(oldState);
    const latestDoc = schema.nodes.doc.create(null, [
      createRootBlock([['before']], 'root-before'),
      createRootBlock([['target']], 'root-table'),
    ]);
    const latestState = EditorState.create({ schema, doc: latestDoc });
    const latestTablePos = findTablePosByRootBlockId(latestState, 'root-table');
    const savedTableInfo: TableInfo = {
      node: oldState.doc.nodeAt(staleTablePos)!,
      pos: staleTablePos,
      rootBlockId: 'root-table',
    };

    const result = resolveTableAiSelectionContext({
      state: latestState,
      selection: TextSelection.create(latestState.doc, 5),
      savedTableInfo,
      savedRect: { top: 0, bottom: 1, left: 0, right: 1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.context.tableInfo.pos).toBe(latestTablePos);
    expect(result.context.tableInfo.node).toBe(latestState.doc.nodeAt(latestTablePos));
    expect(result.context.tableInfo.rootBlockId).toBe('root-table');
  });

  it('rejects saved context when the table is no longer at the saved position', () => {
    const state = createState([['a1']]);
    const result = resolveTableAiSelectionContext({
      state,
      selection: TextSelection.create(state.doc, 5),
      savedTableInfo: {
        node: state.doc.nodeAt(findTablePos(state))!,
        pos: 0,
      },
      savedRect: { top: 0, bottom: 1, left: 0, right: 1 },
    });

    expect(result).toEqual({ ok: false, reason: 'saved-table-missing' });
  });

  it('rejects saved context with an invalid saved rect', () => {
    const state = createState([['a1']]);
    const result = resolveTableAiSelectionContext({
      state,
      selection: TextSelection.create(state.doc, 5),
      savedTableInfo: {
        node: state.doc.nodeAt(findTablePos(state))!,
        pos: findTablePos(state),
      },
      savedRect: { top: 1, bottom: 1, left: 0, right: 1 },
    });

    expect(result).toEqual({ ok: false, reason: 'saved-rect-invalid' });
  });

  it('adjusts table rects after output column insertion', () => {
    expect(adjustTableRectForColumnInsertion({ top: 0, bottom: 1, left: 0, right: 1 }, 2)).toEqual({
      top: 0,
      bottom: 1,
      left: 0,
      right: 1,
    });
    expect(adjustTableRectForColumnInsertion({ top: 0, bottom: 1, left: 3, right: 4 }, 2)).toEqual({
      top: 0,
      bottom: 1,
      left: 4,
      right: 5,
    });
    expect(adjustTableRectForColumnInsertion({ top: 0, bottom: 1, left: 1, right: 3 }, 2)).toEqual({
      top: 0,
      bottom: 1,
      left: 1,
      right: 4,
    });
  });

  it('marks output rect as no longer needing a new column after insertion', () => {
    const rect: TableRect = { top: 0, bottom: 2, left: 1, right: 2 };
    const outputRect: OutputColumnConfig = {
      top: 0,
      bottom: 2,
      left: 2,
      right: 3,
      isOutputColumn: true,
      needsNewColumn: true,
    };

    expect(correctRectsAfterOutputColumnInsertion({ rect, outputRect })).toEqual({
      insertedAtColumn: 2,
      correctedRect: rect,
      correctedOutputRect: {
        top: 0,
        bottom: 2,
        left: 3,
        right: 4,
        isOutputColumn: true,
        needsNewColumn: false,
      },
    });
  });

  it('derives the output column from the selected rect and current table width', () => {
    const state = createState([['a1', 'b1']]);
    const tableNode = state.doc.nodeAt(findTablePos(state));
    if (!tableNode) throw new Error('测试文档缺少 table');

    expect(createOutputColumnConfig(
      { top: 0, bottom: 1, left: 0, right: 1 },
      tableNode,
    )).toEqual({
      top: 0,
      bottom: 1,
      left: 1,
      right: 2,
      isOutputColumn: true,
      needsNewColumn: false,
    });

    expect(createOutputColumnConfig(
      { top: 0, bottom: 1, left: 0, right: 2 },
      tableNode,
    ).needsNewColumn).toBe(true);
  });
});
