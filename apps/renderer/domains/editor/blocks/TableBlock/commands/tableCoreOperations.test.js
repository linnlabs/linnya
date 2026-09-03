// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { describe, expect, it, vi } from 'vitest';
import {
  addColumnBeforeCustom,
  addColumnAfterCustom,
  addRowAfterCustom,
  addRowBeforeCustom,
} from './tableCoreOperations';
import { collapseSelectionToTopLeftCell } from '../toolbar/tableToolbarSelection';

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
      attrs: {
        withHeaderRow: { default: false },
      },
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
    tableHeader: {
      content: 'tableCellContentBlock',
      tableRole: 'header_cell',
      attrs: {
        colspan: { default: 1 },
        rowspan: { default: 1 },
        colwidth: { default: null },
      },
      toDOM: () => ['th', 0],
      parseDOM: [{ tag: 'th' }],
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
      schema.text(text)
    )
  );
}

function createState() {
  const tableRows = [
    schema.nodes.tableRow.create(null, [createCell('a1', [101]), createCell('b1', [202])]),
    schema.nodes.tableRow.create(null, [createCell('a2', [101]), createCell('b2', [202])]),
  ];
  const table = schema.nodes.table.create({ withHeaderRow: false }, tableRows);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'root-table' }, table),
  ]);

  return EditorState.create({ schema, doc });
}

function createColspanState() {
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
  const table = schema.nodes.table.create({ withHeaderRow: false }, tableRows);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'root-table' }, table),
  ]);

  return EditorState.create({ schema, doc });
}

function createRowspanState() {
  const tableRows = [
    schema.nodes.tableRow.create(null, [
      createCell('tall', [101], { rowspan: 2 }),
      createCell('b1', [202]),
      createCell('c1', [303]),
    ]),
    schema.nodes.tableRow.create(null, [
      createCell('b2', [202]),
      createCell('c2', [303]),
    ]),
    schema.nodes.tableRow.create(null, [
      createCell('a3', [101]),
      createCell('b3', [202]),
      createCell('c3', [303]),
    ]),
  ];
  const table = schema.nodes.table.create({ withHeaderRow: false }, tableRows);
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

function getCellPos(tableNode, tablePos, row, col) {
  const map = TableMap.get(tableNode);
  return tablePos + 1 + map.positionAt(row, col, tableNode);
}

function createEditorFixture() {
  return createEditorFixtureFromState(createState());
}

function createEditorFixtureFromState(initialState) {
  let state = initialState;
  const dispatch = vi.fn((tr) => {
    state = state.apply(tr);
  });
  const editor = {
    get state() {
      return state;
    },
    view: { dispatch },
  };

  return {
    editor,
    dispatch,
    getState: () => state,
    setSelection(selection) {
      state = state.apply(state.tr.setSelection(selection));
    },
  };
}

function runCoreCommand(fixture, commandFactory) {
  const tr = fixture.getState().tr;
  const result = commandFactory()({
    tr,
    dispatch: fixture.dispatch,
    editor: fixture.editor,
  });
  if (result) {
    fixture.dispatch(tr);
  }
  return result;
}

function readTableMatrix(doc) {
  const { tableNode } = findTable(doc);
  const rows = [];
  tableNode.forEach((rowNode) => {
    const row = [];
    rowNode.forEach((cellNode) => {
      row.push(cellNode.textContent);
    });
    rows.push(row);
  });
  return rows;
}

function readTableSize(doc) {
  const { tableNode } = findTable(doc);
  const map = TableMap.get(tableNode);
  return {
    width: map.width,
    height: map.height,
  };
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

function readPhysicalRowsWithSpans(doc) {
  const { tableNode } = findTable(doc);
  const rows = [];
  tableNode.forEach((rowNode) => {
    const row = [];
    rowNode.forEach((cellNode) => {
      row.push({
        text: cellNode.textContent,
        colspan: cellNode.attrs.colspan,
        rowspan: cellNode.attrs.rowspan,
        colwidth: cellNode.attrs.colwidth,
      });
    });
    rows.push(row);
  });
  return rows;
}

describe('tableCoreOperations', () => {
  it('inserts a row above the top-left cell after a multi-cell selection is collapsed', () => {
    const fixture = createEditorFixture();
    const { tableNode, tablePos } = findTable(fixture.getState().doc);
    const topLeftCellPos = getCellPos(tableNode, tablePos, 0, 0);
    const bottomRightCellPos = getCellPos(tableNode, tablePos, 1, 1);
    fixture.setSelection(CellSelection.create(fixture.getState().doc, bottomRightCellPos, topLeftCellPos));

    expect(collapseSelectionToTopLeftCell(fixture.editor)).toBe(true);
    expect(runCoreCommand(fixture, addRowBeforeCustom)).toBe(true);

    expect(readTableSize(fixture.getState().doc)).toEqual({ width: 2, height: 3 });
    expect(readTableMatrix(fixture.getState().doc)).toEqual([
      ['', ''],
      ['a1', 'b1'],
      ['a2', 'b2'],
    ]);
    expect(fixture.getState().selection).toBeInstanceOf(TextSelection);
    expect(fixture.getState().selection.$from.parent.type.name).toBe('tableCellContentBlock');
  });

  it('inserts a column after the selected cell and keeps every row rectangular', () => {
    const fixture = createEditorFixture();
    const { tableNode, tablePos } = findTable(fixture.getState().doc);
    const firstCellPos = getCellPos(tableNode, tablePos, 0, 0);
    fixture.setSelection(TextSelection.create(fixture.getState().doc, firstCellPos + 2));

    expect(runCoreCommand(fixture, addColumnAfterCustom)).toBe(true);

    expect(readTableSize(fixture.getState().doc)).toEqual({ width: 3, height: 2 });
    expect(readTableMatrix(fixture.getState().doc)).toEqual([
      ['a1', '', 'b1'],
      ['a2', '', 'b2'],
    ]);
    expect(fixture.getState().selection).toBeInstanceOf(TextSelection);
    expect(fixture.getState().selection.$from.parent.type.name).toBe('tableCellContentBlock');
  });

  it('expands a spanning cell when inserting a column inside its colspan', () => {
    const fixture = createEditorFixtureFromState(createColspanState());
    const { tableNode, tablePos } = findTable(fixture.getState().doc);
    const secondRowMiddleCellPos = getCellPos(tableNode, tablePos, 1, 1);
    fixture.setSelection(TextSelection.create(fixture.getState().doc, secondRowMiddleCellPos + 2));

    expect(runCoreCommand(fixture, addColumnBeforeCustom)).toBe(true);

    expect(readTableSize(fixture.getState().doc)).toEqual({ width: 4, height: 2 });
    expect(readPhysicalRows(fixture.getState().doc)).toEqual([
      [
        { text: 'wide', colspan: 3, colwidth: [101, 0, 202] },
        { text: 'c1', colspan: 1, colwidth: [303] },
      ],
      [
        { text: 'a2', colspan: 1, colwidth: [101] },
        { text: '', colspan: 1, colwidth: [150] },
        { text: 'b2', colspan: 1, colwidth: [202] },
        { text: 'c2', colspan: 1, colwidth: [303] },
      ],
    ]);
    expect(fixture.getState().selection).toBeInstanceOf(TextSelection);
    expect(fixture.getState().selection.$from.parent.type.name).toBe('tableCellContentBlock');
  });

  it('inserts a physical cell after a selected colspan cell at the logical right edge', () => {
    const fixture = createEditorFixtureFromState(createColspanState());
    const { tableNode, tablePos } = findTable(fixture.getState().doc);
    const wideCellPos = getCellPos(tableNode, tablePos, 0, 0);
    fixture.setSelection(TextSelection.create(fixture.getState().doc, wideCellPos + 2));

    expect(runCoreCommand(fixture, addColumnAfterCustom)).toBe(true);

    expect(readTableSize(fixture.getState().doc)).toEqual({ width: 4, height: 2 });
    expect(readPhysicalRows(fixture.getState().doc)).toEqual([
      [
        { text: 'wide', colspan: 2, colwidth: [101, 202] },
        { text: '', colspan: 1, colwidth: [150] },
        { text: 'c1', colspan: 1, colwidth: [303] },
      ],
      [
        { text: 'a2', colspan: 1, colwidth: [101] },
        { text: 'b2', colspan: 1, colwidth: [202] },
        { text: '', colspan: 1, colwidth: [150] },
        { text: 'c2', colspan: 1, colwidth: [303] },
      ],
    ]);
    expect(fixture.getState().selection).toBeInstanceOf(TextSelection);
    expect(fixture.getState().selection.$from.parent.type.name).toBe('tableCellContentBlock');
  });

  it('expands a spanning cell when inserting a row inside its rowspan', () => {
    const fixture = createEditorFixtureFromState(createRowspanState());
    const { tableNode, tablePos } = findTable(fixture.getState().doc);
    const secondRowMiddleCellPos = getCellPos(tableNode, tablePos, 1, 1);
    fixture.setSelection(TextSelection.create(fixture.getState().doc, secondRowMiddleCellPos + 2));

    expect(runCoreCommand(fixture, addRowBeforeCustom)).toBe(true);

    expect(readTableSize(fixture.getState().doc)).toEqual({ width: 3, height: 4 });
    expect(readPhysicalRowsWithSpans(fixture.getState().doc)).toEqual([
      [
        { text: 'tall', colspan: 1, rowspan: 3, colwidth: [101] },
        { text: 'b1', colspan: 1, rowspan: 1, colwidth: [202] },
        { text: 'c1', colspan: 1, rowspan: 1, colwidth: [303] },
      ],
      [
        { text: '', colspan: 1, rowspan: 1, colwidth: [202] },
        { text: '', colspan: 1, rowspan: 1, colwidth: [303] },
      ],
      [
        { text: 'b2', colspan: 1, rowspan: 1, colwidth: [202] },
        { text: 'c2', colspan: 1, rowspan: 1, colwidth: [303] },
      ],
      [
        { text: 'a3', colspan: 1, rowspan: 1, colwidth: [101] },
        { text: 'b3', colspan: 1, rowspan: 1, colwidth: [202] },
        { text: 'c3', colspan: 1, rowspan: 1, colwidth: [303] },
      ],
    ]);
    expect(fixture.getState().selection).toBeInstanceOf(TextSelection);
    expect(fixture.getState().selection.$from.parent.type.name).toBe('tableCellContentBlock');
  });

  it('inserts a row after the selected row while respecting cells that span through the insertion line', () => {
    const fixture = createEditorFixtureFromState(createRowspanState());
    const { tableNode, tablePos } = findTable(fixture.getState().doc);
    const firstRowMiddleCellPos = getCellPos(tableNode, tablePos, 0, 1);
    fixture.setSelection(TextSelection.create(fixture.getState().doc, firstRowMiddleCellPos + 2));

    expect(runCoreCommand(fixture, addRowAfterCustom)).toBe(true);

    expect(readTableSize(fixture.getState().doc)).toEqual({ width: 3, height: 4 });
    expect(readPhysicalRowsWithSpans(fixture.getState().doc)[0][0]).toEqual({
      text: 'tall',
      colspan: 1,
      rowspan: 3,
      colwidth: [101],
    });
    expect(readPhysicalRowsWithSpans(fixture.getState().doc)[1]).toEqual([
      { text: '', colspan: 1, rowspan: 1, colwidth: [202] },
      { text: '', colspan: 1, rowspan: 1, colwidth: [303] },
    ]);
    expect(fixture.getState().selection).toBeInstanceOf(TextSelection);
    expect(fixture.getState().selection.$from.parent.type.name).toBe('tableCellContentBlock');
  });
});
