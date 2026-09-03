// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { TableMap } from '@tiptap/pm/tables';
import { describe, expect, it } from 'vitest';
import { deleteTableColumnAtIndex } from './tableColumnDeletion';
import { deleteColumnByIndex } from './tableDeleteCommands';

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

function createCell(text, colwidth = [90], attrs = {}) {
  return schema.nodes.tableCell.create(
    { colspan: 1, rowspan: 1, colwidth, ...attrs },
    schema.nodes.tableCellContentBlock.create(
      { id: `cell-${text}`, blockType: 'tableCellContent' },
      text ? schema.text(text) : null
    )
  );
}

function createStateWithColspan() {
  const tableRows = [
    schema.nodes.tableRow.create(null, [
      createCell('wide', [101, 202], { colspan: 2 }),
      createCell('c1', [303]),
    ]),
    schema.nodes.tableRow.create(null, [
      createCell('a2', [101]),
      createCell('b2', [202]),
      createCell('c2', [303]),
    ]),
  ];
  const table = schema.nodes.table.create(null, tableRows);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'root-table' }, table),
  ]);

  return EditorState.create({ schema, doc });
}

function createSingleColumnState() {
  const table = schema.nodes.table.create(null, [
    schema.nodes.tableRow.create(null, [createCell('only', [101])]),
  ]);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'root-table' }, table),
  ]);

  return EditorState.create({ schema, doc });
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

function readPhysicalRows(doc) {
  const { tableNode } = findTable(doc);
  const rows = [];
  tableNode.forEach((rowNode) => {
    const row = [];
    rowNode.forEach((cellNode) => {
      row.push({
        text: cellNode.textContent,
        colspan: cellNode.attrs.colspan,
        colwidth: cellNode.attrs.colwidth,
      });
    });
    rows.push(row);
  });
  return rows;
}

function readTableWidth(doc) {
  const { tableNode } = findTable(doc);
  return TableMap.get(tableNode).width;
}

function createChainEditor(initialState) {
  let state = initialState;
  let commandHandler = null;
  const chain = {
    focus() {
      return chain;
    },
    command(handler) {
      commandHandler = handler;
      return chain;
    },
    run() {
      if (!commandHandler) return false;
      const tr = state.tr;
      const result = commandHandler({ tr });
      if (result) {
        state = state.apply(tr);
      }
      return result;
    },
  };

  return {
    editor: {
      chain() {
        return chain;
      },
    },
    getState() {
      return state;
    },
  };
}

describe('tableColumnDeletion', () => {
  it('deletes only the requested logical column inside a colspan cell', () => {
    const state = createStateWithColspan();
    const { tablePos } = findTable(state.doc);
    const tr = state.tr;

    expect(deleteTableColumnAtIndex({ tr, tablePos, columnIndex: 1 })).toEqual({
      deletedColumnIndex: 1,
      remainingWidth: 2,
    });

    const nextState = state.apply(tr);
    expect(readTableWidth(nextState.doc)).toBe(2);
    expect(readPhysicalRows(nextState.doc)).toEqual([
      [
        { text: 'wide', colspan: 1, colwidth: [101] },
        { text: 'c1', colspan: 1, colwidth: [303] },
      ],
      [
        { text: 'a2', colspan: 1, colwidth: [101] },
        { text: 'c2', colspan: 1, colwidth: [303] },
      ],
    ]);
    expect(nextState.selection).toBeInstanceOf(TextSelection);
    expect(nextState.selection.$from.parent.type.name).toBe('tableCellContentBlock');
  });

  it('deletes the first logical column of a colspan cell without deleting the whole spanning cell', () => {
    const state = createStateWithColspan();
    const { tablePos } = findTable(state.doc);
    const tr = state.tr;

    expect(deleteTableColumnAtIndex({ tr, tablePos, columnIndex: 0 })).toEqual({
      deletedColumnIndex: 0,
      remainingWidth: 2,
    });

    const nextState = state.apply(tr);
    expect(readPhysicalRows(nextState.doc)).toEqual([
      [
        { text: 'wide', colspan: 1, colwidth: [202] },
        { text: 'c1', colspan: 1, colwidth: [303] },
      ],
      [
        { text: 'b2', colspan: 1, colwidth: [202] },
        { text: 'c2', colspan: 1, colwidth: [303] },
      ],
    ]);
  });

  it('refuses to delete the final remaining logical column', () => {
    const state = createSingleColumnState();
    const { tablePos } = findTable(state.doc);
    const tr = state.tr;

    expect(deleteTableColumnAtIndex({ tr, tablePos, columnIndex: 0 })).toBeNull();
    expect(state.apply(tr).doc.toJSON()).toEqual(state.doc.toJSON());
  });

  it('uses logical column deletion in deleteColumnByIndex without going through CellSelection', () => {
    const state = createStateWithColspan();
    const { tablePos } = findTable(state.doc);
    const fixture = createChainEditor(state);

    expect(deleteColumnByIndex(fixture.editor, tablePos, 1)).toBe(true);
    expect(readPhysicalRows(fixture.getState().doc)).toEqual([
      [
        { text: 'wide', colspan: 1, colwidth: [101] },
        { text: 'c1', colspan: 1, colwidth: [303] },
      ],
      [
        { text: 'a2', colspan: 1, colwidth: [101] },
        { text: 'c2', colspan: 1, colwidth: [303] },
      ],
    ]);
  });
});
