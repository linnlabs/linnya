// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { TableMap } from '@tiptap/pm/tables';
import { describe, expect, it } from 'vitest';
import { fillTableCells } from './tableFillCommands';
import {
  normalizeFillRows,
  resolveTableFillTargets,
} from './tableFillTargets';

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
      attrs: {
        id: { default: null },
        blockType: { default: 'tableCellContent' },
      },
      toDOM: () => ['div', 0],
      parseDOM: [{ tag: 'div' }],
    },
  },
});

function contentBlock(text) {
  return schema.nodes.tableCellContentBlock.create(
    { id: `cell-${text || 'empty'}`, blockType: 'tableCellContent' },
    text ? schema.text(text) : null
  );
}

function cell(text, attrs = {}) {
  return schema.nodes.tableCell.create(
    { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
    contentBlock(text)
  );
}

function createDoc(rows) {
  const table = schema.nodes.table.create(
    null,
    rows.map((row) => schema.nodes.tableRow.create(null, row))
  );

  return schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'root-table' }, table),
  ]);
}

function findTable(doc) {
  let tableNode = null;
  let tablePos = null;

  doc.descendants((node, pos) => {
    if (node.type.name !== 'table' || tableNode) return true;
    tableNode = node;
    tablePos = pos;
    return false;
  });

  if (!tableNode || tablePos === null) {
    throw new Error('测试文档缺少 table');
  }

  return { tableNode, tablePos };
}

function cellDocPos(doc, row, col) {
  const { tableNode, tablePos } = findTable(doc);
  const map = TableMap.get(tableNode);
  return tablePos + 1 + map.positionAt(row, col, tableNode);
}

function selectCellText(state, row, col) {
  const pos = cellDocPos(state.doc, row, col) + 2;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

function readPhysicalRows(doc) {
  const { tableNode } = findTable(doc);
  const rows = [];

  tableNode.forEach((rowNode) => {
    const row = [];
    rowNode.forEach((cellNode) => {
      row.push({
        text: cellNode.textContent,
        colspan: cellNode.attrs.colspan,
        rowspan: cellNode.attrs.rowspan,
      });
    });
    rows.push(row);
  });

  return rows;
}

function createColspanState() {
  const doc = createDoc([
    [
      cell('wide', { colspan: 2 }),
      cell('c1'),
    ],
    [
      cell('a2'),
      cell('b2'),
      cell('c2'),
    ],
  ]);

  return selectCellText(EditorState.create({ schema, doc }), 1, 0);
}

function createRowspanState() {
  const doc = createDoc([
    [
      cell('tall', { rowspan: 2 }),
      cell('b1'),
    ],
    [
      cell('b2'),
    ],
  ]);

  return selectCellText(EditorState.create({ schema, doc }), 0, 1);
}

describe('tableFillTargets', () => {
  it('resolves logical columns through TableMap instead of physical child indexes', () => {
    let state = createColspanState();
    const command = fillTableCells({
      content: 'filled',
      targetColumnIndex: 1,
      targetRows: [0],
    });

    const result = command({
      tr: state.tr,
      state,
      dispatch: (tr) => {
        state = state.apply(tr);
      },
      editor: {},
    });

    expect(result).toBe(true);
    expect(readPhysicalRows(state.doc)).toEqual([
      [
        { text: 'filled', colspan: 2, rowspan: 1 },
        { text: 'c1', colspan: 1, rowspan: 1 },
      ],
      [
        { text: 'a2', colspan: 1, rowspan: 1 },
        { text: 'b2', colspan: 1, rowspan: 1 },
        { text: 'c2', colspan: 1, rowspan: 1 },
      ],
    ]);
  });

  it('deduplicates one physical rowspan cell covered by multiple logical rows', () => {
    const state = createRowspanState();
    const { tableNode, tablePos } = findTable(state.doc);
    const map = TableMap.get(tableNode);
    const rowsToFill = normalizeFillRows({ map, targetRows: [0, 1] });

    const { targets, skipped } = resolveTableFillTargets({
      state,
      tableNode,
      tableStartPos: tablePos,
      map,
      targetColumnIndex: 0,
      rowsToFill,
    });

    expect(targets).toHaveLength(1);
    expect(targets[0].cellPos).toBe(cellDocPos(state.doc, 0, 0));
    expect(skipped).toEqual([
      {
        reason: 'duplicate-spanned-cell',
        rowIndex: 1,
        columnIndex: 0,
        cellOffset: targets[0].cellOffset,
      },
    ]);
  });
});
