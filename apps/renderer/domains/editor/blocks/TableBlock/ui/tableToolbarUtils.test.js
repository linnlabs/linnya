// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { CellSelection } from '@tiptap/pm/tables';
import { describe, expect, it, vi } from 'vitest';
import { calculateToolbarPosition } from './tableToolbarUtils';
import { getCellOffsetAtLogicalPosition, getTableMap } from '../position/tableMapUtils';
import { getCellContentBlockPositions } from '../utils/tableContentUtils';
import { ROOT_BLOCK_RENDER_MODE_DATA_ATTR } from '../../../features/RenderVirtualization/view/rootBlockRenderMode';

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
  return schema.nodes.tableCell.create(
    { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
    schema.nodes.tableCellContentBlock.create(null, schema.text(text))
  );
}

function normalizeCell(cellValue) {
  if (cellValue && typeof cellValue === 'object' && cellValue.type === schema.nodes.tableCell) {
    return cellValue;
  }

  return createCell(cellValue);
}

function createState(rows = [
  ['a1', 'b1'],
  ['a2', 'b2'],
]) {
  const tableRows = rows.map((row) => schema.nodes.tableRow.create(null, row.map(normalizeCell)));
  const table = schema.nodes.table.create(null, tableRows);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'root-table' }, table),
  ]);
  return EditorState.create({ schema, doc });
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
    throw new Error('测试文档缺少 table');
  }

  return { tableNode, tablePos };
}

function getCellPos(tableNode, tablePos, row, col) {
  const map = getTableMap(tableNode);
  const cellOffset = map ? getCellOffsetAtLogicalPosition(map, row, col) : null;
  if (cellOffset === null) {
    throw new Error(`无法解析逻辑单元格 offset: row=${row}, col=${col}`);
  }

  return tablePos + 1 + cellOffset;
}

function getCellContentStart(state, row, col) {
  const { tableNode, tablePos } = findTableInfo(state.doc);
  const cellPos = getCellPos(tableNode, tablePos, row, col);
  const cellNode = state.doc.nodeAt(cellPos);
  const positions = getCellContentBlockPositions(cellNode, cellPos);
  if (!positions) {
    throw new Error(`无法解析单元格内容位置: row=${row}, col=${col}`);
  }

  return positions.start;
}

function createDomRect({ left, top, width = 80, height = 24 }) {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  };
}

function withWindowScroll({ scrollX, scrollY }, run) {
  const originalScrollX = window.scrollX;
  const originalScrollY = window.scrollY;
  Object.defineProperty(window, 'scrollX', { value: scrollX, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });

  try {
    return run();
  } finally {
    Object.defineProperty(window, 'scrollX', { value: originalScrollX, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: originalScrollY, configurable: true });
  }
}

describe('tableToolbarUtils', () => {
  it('returns null outside CellSelection or when the editor is not editable', () => {
    let state = createState();
    const { tableNode, tablePos } = findTableInfo(state.doc);
    const firstCellPos = getCellPos(tableNode, tablePos, 0, 0);
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, firstCellPos + 2)));

    const editorView = {
      editable: true,
      state,
      nodeDOM: vi.fn(),
      coordsAtPos: vi.fn(),
    };

    expect(calculateToolbarPosition(editorView, state.selection)).toBeNull();

    const cellSelection = CellSelection.create(state.doc, firstCellPos);
    expect(calculateToolbarPosition({ ...editorView, editable: false }, cellSelection)).toBeNull();
  });

  it('positions the toolbar from the selected cell DOM rect', () => {
    const state = createState();
    const { tableNode, tablePos } = findTableInfo(state.doc);
    const firstCellPos = getCellPos(tableNode, tablePos, 0, 0);
    const secondCellPos = getCellPos(tableNode, tablePos, 1, 1);
    const selection = CellSelection.create(state.doc, secondCellPos, firstCellPos);
    const cell = document.createElement('td');
    const content = document.createElement('div');
    cell.getBoundingClientRect = () => createDomRect({ left: 50, top: 100 });
    cell.appendChild(content);

    const editorView = {
      editable: true,
      state,
      nodeDOM: vi.fn(() => content),
      coordsAtPos: vi.fn(),
    };

    const result = withWindowScroll({ scrollX: 5, scrollY: 20 }, () =>
      calculateToolbarPosition(editorView, selection)
    );

    expect(result).toEqual({ top: 72, left: 55 });
    expect(editorView.nodeDOM).toHaveBeenCalledWith(getCellContentStart(state, 0, 0));
    expect(editorView.coordsAtPos).not.toHaveBeenCalled();
  });

  it('positions the toolbar from the real cell covering a rowspan top-left logical coordinate', () => {
    const state = createState([
      [createCell('tall', { rowspan: 2 }), 'b1'],
      ['b2'],
    ]);
    const { tableNode, tablePos } = findTableInfo(state.doc);
    const spanningCellPos = getCellPos(tableNode, tablePos, 0, 0);
    const rightCellPos = getCellPos(tableNode, tablePos, 1, 1);
    const selection = CellSelection.create(state.doc, rightCellPos, spanningCellPos);
    const cell = document.createElement('td');
    const content = document.createElement('div');
    cell.getBoundingClientRect = () => createDomRect({ left: 70, top: 160 });
    cell.appendChild(content);

    const editorView = {
      editable: true,
      state,
      nodeDOM: vi.fn(() => content),
      coordsAtPos: vi.fn(),
    };

    const result = withWindowScroll({ scrollX: 0, scrollY: 0 }, () =>
      calculateToolbarPosition(editorView, selection)
    );

    expect(result).toEqual({ top: 112, left: 70 });
    expect(editorView.nodeDOM).toHaveBeenCalledWith(getCellContentStart(state, 0, 0));
    expect(editorView.coordsAtPos).not.toHaveBeenCalled();
  });

  it('falls back to coordsAtPos when nodeDOM cannot resolve an HTMLElement', () => {
    const state = createState();
    const { tableNode, tablePos } = findTableInfo(state.doc);
    const firstCellPos = getCellPos(tableNode, tablePos, 0, 0);
    const selection = CellSelection.create(state.doc, firstCellPos);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const editorView = {
      editable: true,
      state,
      nodeDOM: vi.fn(() => null),
      coordsAtPos: vi.fn(() => ({ top: 200, left: 80 })),
    };

    try {
      const result = withWindowScroll({ scrollX: 3, scrollY: 7 }, () =>
        calculateToolbarPosition(editorView, selection)
      );

      expect(result).toEqual({ top: 167, left: 83 });
      expect(editorView.coordsAtPos).toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('does not call coordsAtPos when the selected table rootBlock is a virtualization placeholder', () => {
    const state = createState();
    const { tableNode, tablePos } = findTableInfo(state.doc);
    const firstCellPos = getCellPos(tableNode, tablePos, 0, 0);
    const selection = CellSelection.create(state.doc, firstCellPos);
    const editorDom = document.createElement('div');
    const placeholderRootBlock = document.createElement('div');
    placeholderRootBlock.className = 'root-block-outer root-block-virtual-placeholder';
    placeholderRootBlock.setAttribute('data-id', 'root-table');
    placeholderRootBlock.setAttribute('data-placeholder', 'true');
    placeholderRootBlock.setAttribute(ROOT_BLOCK_RENDER_MODE_DATA_ATTR, 'placeholder');
    editorDom.appendChild(placeholderRootBlock);

    const editorView = {
      dom: editorDom,
      editable: true,
      state,
      nodeDOM: vi.fn(() => null),
      coordsAtPos: vi.fn(() => ({ top: 200, left: 80 })),
    };

    expect(calculateToolbarPosition(editorView, selection)).toBeNull();
    expect(editorView.nodeDOM).not.toHaveBeenCalled();
    expect(editorView.coordsAtPos).not.toHaveBeenCalled();
  });

  it('returns null when both DOM and coords fallback fail', () => {
    const state = createState();
    const { tableNode, tablePos } = findTableInfo(state.doc);
    const firstCellPos = getCellPos(tableNode, tablePos, 0, 0);
    const selection = CellSelection.create(state.doc, firstCellPos);
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const editorView = {
      editable: true,
      state,
      nodeDOM: vi.fn(() => {
        throw new Error('missing dom');
      }),
      coordsAtPos: vi.fn(() => {
        throw new Error('missing coords');
      }),
    };

    try {
      expect(calculateToolbarPosition(editorView, selection)).toBeNull();
    } finally {
      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});
