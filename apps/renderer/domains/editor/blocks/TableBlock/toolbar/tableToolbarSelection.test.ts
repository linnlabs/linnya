// @vitest-environment jsdom

import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { CellSelection } from '@tiptap/pm/tables';
import { describe, expect, it, vi } from 'vitest';
import {
  collapseSelectionToTopLeftCell,
  ensureCellSelection,
  executeTableToolbarCommand,
  type TableToolbarEditor,
} from './tableToolbarSelection';
import { getCellOffsetAtLogicalPosition, getTableMap } from '../position/tableMapUtils';

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

const nonTableSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
  },
});

interface EditorFixture {
  editor: TableToolbarEditor;
  dispatch: ReturnType<typeof vi.fn>;
  tableNode: ProseMirrorNode;
  tablePos: number;
  getState(): EditorState;
}

interface TableCellAttrs {
  colspan?: number;
  rowspan?: number;
  colwidth?: number[] | null;
}

function createCell(text: string, attrs: TableCellAttrs = {}): ProseMirrorNode {
  return schema.nodes.tableCell.create(
    { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
    schema.nodes.tableCellContentBlock.create(null, schema.text(text))
  );
}

function findTable(doc: ProseMirrorNode): { tableNode: ProseMirrorNode; tablePos: number } {
  let tableNode: ProseMirrorNode | null = null;
  let tablePos: number | null = null;

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

function getCellPos(tableNode: ProseMirrorNode, tablePos: number, row: number, col: number): number {
  const map = getTableMap(tableNode);
  const cellOffset = map ? getCellOffsetAtLogicalPosition(map, row, col) : null;
  if (cellOffset === null) {
    throw new Error(`无法解析逻辑单元格 offset: row=${row}, col=${col}`);
  }

  return tablePos + 1 + cellOffset;
}

function createFixture(rows: ProseMirrorNode[][] = [
  [createCell('a1'), createCell('b1')],
  [createCell('a2'), createCell('b2')],
]): EditorFixture {
  const tableRows = rows.map((row) => schema.nodes.tableRow.create(null, row));
  const table = schema.nodes.table.create(null, tableRows);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'root-table' }, table),
  ]);
  let state = EditorState.create({ schema, doc });
  const { tableNode, tablePos } = findTable(doc);
  const dispatch = vi.fn((tr: Transaction) => {
    state = state.apply(tr);
  });

  const editor = {
    get state() {
      return state;
    },
    view: {
      dispatch,
    },
  } as unknown as TableToolbarEditor;

  return {
    editor,
    dispatch,
    tableNode,
    tablePos,
    getState: () => state,
  };
}

describe('tableToolbarSelection', () => {
  it('promotes a text selection inside a table cell to CellSelection', () => {
    const fixture = createFixture();
    const firstCellPos = getCellPos(fixture.tableNode, fixture.tablePos, 0, 0);
    fixture.dispatch(
      fixture.getState().tr.setSelection(TextSelection.create(fixture.getState().doc, firstCellPos + 2))
    );

    expect(ensureCellSelection(fixture.editor)).toBe(true);
    expect(fixture.getState().selection).toBeInstanceOf(CellSelection);
  });

  it('collapses a multi-cell selection to the top-left cell before row insertion', () => {
    const fixture = createFixture();
    const topLeftCellPos = getCellPos(fixture.tableNode, fixture.tablePos, 0, 0);
    const bottomRightCellPos = getCellPos(fixture.tableNode, fixture.tablePos, 1, 1);
    fixture.dispatch(
      fixture.getState().tr.setSelection(
        CellSelection.create(fixture.getState().doc, bottomRightCellPos, topLeftCellPos)
      )
    );

    expect(collapseSelectionToTopLeftCell(fixture.editor)).toBe(true);

    const selection = fixture.getState().selection;
    expect(selection).toBeInstanceOf(CellSelection);
    if (selection instanceof CellSelection) {
      expect(selection.$anchorCell.pos).toBe(topLeftCellPos);
      expect(selection.$headCell.pos).toBe(topLeftCellPos);
    }
  });

  it('collapses to the real cell covering the top-left logical coordinate', () => {
    const fixture = createFixture([
      [createCell('tall', { rowspan: 2 }), createCell('b1')],
      [createCell('b2')],
    ]);
    const spanningCellPos = getCellPos(fixture.tableNode, fixture.tablePos, 0, 0);
    const rightCellPos = getCellPos(fixture.tableNode, fixture.tablePos, 1, 1);
    fixture.dispatch(
      fixture.getState().tr.setSelection(
        CellSelection.create(fixture.getState().doc, rightCellPos, spanningCellPos)
      )
    );

    expect(collapseSelectionToTopLeftCell(fixture.editor)).toBe(true);

    const selection = fixture.getState().selection;
    expect(selection).toBeInstanceOf(CellSelection);
    if (selection instanceof CellSelection) {
      expect(selection.$anchorCell.pos).toBe(spanningCellPos);
      expect(selection.$headCell.pos).toBe(spanningCellPos);
    }
  });

  it('ensures a cell selection before running a toolbar command', () => {
    const fixture = createFixture();
    const firstCellPos = getCellPos(fixture.tableNode, fixture.tablePos, 0, 0);
    fixture.dispatch(
      fixture.getState().tr.setSelection(TextSelection.create(fixture.getState().doc, firstCellPos + 2))
    );

    const command = vi.fn((editor: TableToolbarEditor) => editor.state.selection instanceof CellSelection);

    expect(executeTableToolbarCommand(fixture.editor, command)).toBe(true);
    expect(command).toHaveBeenCalledOnce();
    expect(fixture.getState().selection).toBeInstanceOf(CellSelection);
  });

  it('does not run toolbar commands when the selection cannot become a CellSelection', () => {
    let state = EditorState.create({
      schema: nonTableSchema,
      doc: nonTableSchema.nodes.doc.create(null, [
        nonTableSchema.nodes.paragraph.create(null, nonTableSchema.text('outside table')),
      ]),
    });
    const dispatch = vi.fn((tr: Transaction) => {
      state = state.apply(tr);
    });
    const editor = {
      get state() {
        return state;
      },
      view: {
        dispatch,
      },
    } as unknown as TableToolbarEditor;
    const command = vi.fn(() => true);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      expect(executeTableToolbarCommand(editor, command)).toBe(false);
      expect(command).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('reports command failures without throwing to the toolbar UI', () => {
    const fixture = createFixture();
    const failingCommand = vi.fn(() => false);
    const throwingCommand = vi.fn(() => {
      throw new Error('boom');
    });
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      expect(executeTableToolbarCommand(fixture.editor, failingCommand)).toBe(false);
      expect(executeTableToolbarCommand(fixture.editor, throwingCommand)).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
