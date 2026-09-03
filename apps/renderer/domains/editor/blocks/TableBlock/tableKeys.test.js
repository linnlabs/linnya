// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import { handleArrowVertical, handleEnterKey, handleShiftTabKey, handleTabKey } from './tableKeys';
import { getCellOffsetAtLogicalPosition, getTableMap } from './position/tableMapUtils';
import { getCellContentBlockPositions } from './utils/tableContentUtils';

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

function createCell(text, attrs = {}) {
  const content = text ? schema.text(text) : null;
  return schema.nodes.tableCell.create(
    { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
    schema.nodes.tableCellContentBlock.create(null, content)
  );
}

function normalizeCell(cellValue) {
  if (cellValue && typeof cellValue === 'object' && cellValue.type === schema.nodes.tableCell) {
    return cellValue;
  }

  return createCell(cellValue);
}

function createDoc(rows) {
  const tableRows = rows.map((row) => schema.nodes.tableRow.create(null, row.map(normalizeCell)));
  const table = schema.nodes.table.create(null, tableRows);
  const rootBlock = schema.nodes.rootBlock.create({ id: 'root-table' }, table);
  return schema.nodes.doc.create(null, [rootBlock]);
}

function findTableInfo(doc) {
  let tableNode = null;
  let tablePos = null;

  doc.descendants((node, pos) => {
    if (node.type.name !== 'table' || tableNode) return true;
    tableNode = node;
    tablePos = pos;
    return false;
  });

  if (!tableNode || tablePos === null) {
    throw new Error('测试文档缺少 table 节点');
  }

  return { tableNode, tablePos };
}

function getCellPositions(state, rowIndex, colIndex) {
  const { tableNode, tablePos } = findTableInfo(state.doc);
  const map = getTableMap(tableNode);
  const cellOffset = map ? getCellOffsetAtLogicalPosition(map, rowIndex, colIndex) : null;
  if (cellOffset === null) {
    throw new Error(`无法解析逻辑单元格 offset: row=${rowIndex}, col=${colIndex}`);
  }

  const cellPos = tablePos + 1 + cellOffset;
  const cellNode = state.doc.nodeAt(cellPos);
  if (!cellNode) {
    throw new Error(`无法读取单元格节点: row=${rowIndex}, col=${colIndex}`);
  }

  const positions = getCellContentBlockPositions(cellNode, cellPos);

  if (!positions) {
    throw new Error(`无法解析单元格位置: row=${rowIndex}, col=${colIndex}`);
  }

  return {
    cellPos,
    cellNode,
    ...positions,
  };
}

function selectionParentName(state) {
  return state.selection.$from.parent.type.name;
}

function createRect({ left = 10, right = 110, top, bottom }) {
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function createEditorFixture(rows, selectionCell, selectionEdge = 'contentStart', viewOverrides = {}) {
  let state = EditorState.create({ schema, doc: createDoc(rows) });
  const initialPositions = getCellPositions(state, selectionCell.row, selectionCell.col);
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, initialPositions[selectionEdge]))
  );

  const view = {
    get state() {
      return state;
    },
    dispatch: vi.fn((tr) => {
      state = state.apply(tr);
    }),
    ...viewOverrides,
  };

  const commands = {
    createRootBlock: vi.fn(() => true),
    goToNextCell: vi.fn(() => false),
  };

  const editor = {
    schema,
    view,
    commands,
  };

  return {
    editor,
    commands,
    view,
    get state() {
      return state;
    },
  };
}

function withRangeClientRects(rectsByTextNode, run) {
  const originalGetClientRects = Range.prototype.getClientRects;
  Range.prototype.getClientRects = function getClientRects() {
    const rects = rectsByTextNode.get(this.startContainer);
    return rects ?? [];
  };

  try {
    return run();
  } finally {
    Range.prototype.getClientRects = originalGetClientRects;
  }
}

describe('tableKeys', () => {
  it('moves Enter from a non-last row into the next row content end', () => {
    const fixture = createEditorFixture(
      [
        ['a1', 'b1'],
        ['a2', 'b2'],
      ],
      { row: 0, col: 0 }
    );
    const target = getCellPositions(fixture.state, 1, 0).contentEnd;

    expect(handleEnterKey({ editor: fixture.editor })).toBe(true);

    expect(fixture.state.selection.from).toBe(target);
    expect(selectionParentName(fixture.state)).toBe('tableCellContentBlock');
  });

  it('moves Enter below the full rowspan span instead of the next physical row', () => {
    const fixture = createEditorFixture(
      [
        [createCell('tall', { rowspan: 2 }), createCell('b1')],
        [createCell('b2')],
        ['a3', 'b3'],
      ],
      { row: 0, col: 0 },
      'contentEnd'
    );
    const target = getCellPositions(fixture.state, 2, 0).contentEnd;

    expect(handleEnterKey({ editor: fixture.editor })).toBe(true);

    expect(fixture.state.selection.from).toBe(target);
    expect(selectionParentName(fixture.state)).toBe('tableCellContentBlock');
  });

  it('exits the table on Enter when the current rowspan reaches the table bottom', () => {
    const fixture = createEditorFixture(
      [
        [createCell('tall', { rowspan: 2 }), createCell('b1')],
        [createCell('b2')],
      ],
      { row: 0, col: 0 },
      'contentEnd'
    );
    const referencePos = fixture.state.selection.$head.pos;

    expect(handleEnterKey({ editor: fixture.editor })).toBe(true);

    expect(fixture.commands.createRootBlock).toHaveBeenCalledWith({
      position: 'after',
      referencePos,
    });
  });

  it('delegates Enter on the last row to createRootBlock after the table root', () => {
    const fixture = createEditorFixture(
      [
        ['a1', 'b1'],
        ['a2', 'b2'],
      ],
      { row: 1, col: 0 }
    );
    const referencePos = fixture.state.selection.$head.pos;

    expect(handleEnterKey({ editor: fixture.editor })).toBe(true);

    expect(fixture.commands.createRootBlock).toHaveBeenCalledWith({
      position: 'after',
      referencePos,
    });
  });

  it('moves Tab to the next cell content end after goToNextCell succeeds', () => {
    const fixture = createEditorFixture([['a1', 'b1']], { row: 0, col: 0 });

    fixture.commands.goToNextCell.mockImplementation(() => {
      const target = getCellPositions(fixture.state, 0, 1).contentStart;
      fixture.view.dispatch(
        fixture.state.tr.setSelection(TextSelection.create(fixture.state.doc, target))
      );
      return true;
    });

    const target = getCellPositions(fixture.state, 0, 1).contentEnd;

    expect(handleTabKey({ editor: fixture.editor })).toBe(true);

    expect(fixture.state.selection.from).toBe(target);
    expect(selectionParentName(fixture.state)).toBe('tableCellContentBlock');
  });

  it('adds a row on Tab from the last cell and focuses the new first cell', () => {
    const fixture = createEditorFixture([['a1', 'b1']], { row: 0, col: 1 });

    expect(handleTabKey({ editor: fixture.editor })).toBe(true);

    const { tableNode } = findTableInfo(fixture.state.doc);
    const target = getCellPositions(fixture.state, 1, 0).contentStart;

    expect(tableNode.childCount).toBe(2);
    expect(fixture.state.selection.from).toBe(target);
    expect(selectionParentName(fixture.state)).toBe('tableCellContentBlock');
  });

  it('moves Shift+Tab to the previous cell content end', () => {
    const fixture = createEditorFixture([['a1', 'b1']], { row: 0, col: 1 });
    const target = getCellPositions(fixture.state, 0, 0).contentEnd;

    expect(handleShiftTabKey({ editor: fixture.editor })).toBe(true);

    expect(fixture.state.selection.from).toBe(target);
    expect(selectionParentName(fixture.state)).toBe('tableCellContentBlock');
  });

  it('moves Shift+Tab into the cell that covers the previous logical column', () => {
    const fixture = createEditorFixture(
      [
        [createCell('tall', { rowspan: 2 }), createCell('b1')],
        [createCell('b2')],
      ],
      { row: 1, col: 1 },
      'contentStart'
    );
    const target = getCellPositions(fixture.state, 1, 0).contentEnd;

    expect(handleShiftTabKey({ editor: fixture.editor })).toBe(true);

    expect(fixture.state.selection.from).toBe(target);
    expect(selectionParentName(fixture.state)).toBe('tableCellContentBlock');
  });

  it('lets ProseMirror handle ArrowDown when the cursor is not at the cell bottom edge', () => {
    const fixture = createEditorFixture(
      [
        ['a1', 'b1'],
        ['a2', 'b2'],
      ],
      { row: 0, col: 0 },
      'contentStart',
      {
        coordsAtPos: vi.fn((pos) => {
          const current = getCellPositions(fixture.state, 0, 0);
          if (pos === current.contentStart) return createRect({ top: 100, bottom: 110 });
          if (pos === current.contentEnd) return createRect({ top: 160, bottom: 170 });
          return createRect({ top: 0, bottom: 0 });
        }),
      }
    );
    const event = { preventDefault: vi.fn() };

    expect(handleArrowVertical({ editor: fixture.editor, event, direction: 1 })).toBe(false);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fixture.view.dispatch).not.toHaveBeenCalled();
  });

  it('moves ArrowDown to the target cell position returned by posAtCoords', () => {
    const fixture = createEditorFixture(
      [
        ['a1', 'b1'],
        ['a2', 'b2'],
      ],
      { row: 0, col: 0 },
      'contentEnd'
    );
    const current = getCellPositions(fixture.state, 0, 0);
    const targetCell = getCellPositions(fixture.state, 1, 0);
    const targetPos = targetCell.contentStart + 1;
    const targetCellDom = document.createElement('td');
    targetCellDom.getBoundingClientRect = vi.fn(() => createRect({ top: 200, bottom: 240 }));

    fixture.view.coordsAtPos = vi.fn((pos) => {
      if (pos === current.contentEnd) return createRect({ left: 42, right: 43, top: 160, bottom: 170 });
      return createRect({ left: 42, right: 43, top: 0, bottom: 0 });
    });
    fixture.view.nodeDOM = vi.fn((pos) => (pos === targetCell.cellPos ? targetCellDom : null));
    fixture.view.posAtCoords = vi.fn(() => ({ pos: targetPos }));

    const event = { preventDefault: vi.fn() };

    expect(handleArrowVertical({ editor: fixture.editor, event, direction: 1 })).toBe(true);

    expect(fixture.state.selection.from).toBe(targetPos);
    expect(selectionParentName(fixture.state)).toBe('tableCellContentBlock');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(fixture.view.dispatch.mock.calls[0][0].getMeta('isVerticalNav')).toBe(true);
  });

  it('moves ArrowDown below a rowspan span before probing coordinates', () => {
    const fixture = createEditorFixture(
      [
        [createCell('tall', { rowspan: 2 }), createCell('b1')],
        [createCell('b2')],
        ['a3', 'b3'],
      ],
      { row: 0, col: 0 },
      'contentEnd'
    );
    const current = getCellPositions(fixture.state, 0, 0);
    const targetCell = getCellPositions(fixture.state, 2, 0);
    const targetPos = targetCell.contentStart + 1;
    const targetCellDom = document.createElement('td');
    targetCellDom.getBoundingClientRect = vi.fn(() => createRect({ top: 260, bottom: 300 }));

    fixture.view.coordsAtPos = vi.fn((pos) => {
      if (pos === current.contentEnd) return createRect({ left: 42, right: 43, top: 160, bottom: 170 });
      return createRect({ left: 42, right: 43, top: 0, bottom: 0 });
    });
    fixture.view.nodeDOM = vi.fn((pos) => (pos === targetCell.cellPos ? targetCellDom : null));
    fixture.view.posAtCoords = vi.fn(() => ({ pos: targetPos }));

    const event = { preventDefault: vi.fn() };

    expect(handleArrowVertical({ editor: fixture.editor, event, direction: 1 })).toBe(true);

    expect(fixture.state.selection.from).toBe(targetPos);
    expect(selectionParentName(fixture.state)).toBe('tableCellContentBlock');
    expect(fixture.view.nodeDOM).toHaveBeenCalledWith(targetCell.cellPos);
  });

  it('falls back to the custom cell geometry resolver when posAtCoords misses the target content', () => {
    const fixture = createEditorFixture(
      [
        ['a1', 'b1'],
        ['a2', 'b2'],
      ],
      { row: 0, col: 0 },
      'contentEnd'
    );
    const current = getCellPositions(fixture.state, 0, 0);
    const targetCell = getCellPositions(fixture.state, 1, 0);
    const targetCellDom = document.createElement('td');
    const targetContentDom = document.createElement('div');
    const targetText = document.createTextNode('a2');
    const originalCaretRangeFromPoint = document.caretRangeFromPoint;

    targetContentDom.appendChild(targetText);
    targetCellDom.getBoundingClientRect = vi.fn(() => createRect({ top: 200, bottom: 360 }));

    fixture.view.coordsAtPos = vi.fn((pos) => {
      if (pos === current.contentEnd) return createRect({ left: 42, right: 43, top: 160, bottom: 170 });
      return createRect({ left: 42, right: 43, top: 0, bottom: 0 });
    });
    fixture.view.nodeDOM = vi.fn((pos) => {
      if (pos === targetCell.cellPos) return targetCellDom;
      if (pos === targetCell.start) return targetContentDom;
      return null;
    });
    fixture.view.posAtCoords = vi.fn(() => ({ pos: current.contentStart }));
    fixture.view.posAtDOM = vi.fn((node, offset) => {
      if (node !== targetText) return -1;
      return targetCell.contentStart + offset;
    });
    document.caretRangeFromPoint = vi.fn(() => {
      const range = document.createRange();
      range.setStart(targetText, 1);
      range.collapse(true);
      return range;
    });

    try {
      const result = withRangeClientRects(
        new Map([[targetText, [createRect({ top: 210, bottom: 230 })]]]),
        () => handleArrowVertical({
          editor: fixture.editor,
          event: { preventDefault: vi.fn() },
          direction: 1,
        })
      );

      expect(result).toBe(true);
      expect(fixture.state.selection.from).toBe(targetCell.contentStart + 1);
      expect(selectionParentName(fixture.state)).toBe('tableCellContentBlock');
    } finally {
      document.caretRangeFromPoint = originalCaretRangeFromPoint;
    }
  });
});
