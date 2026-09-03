// @vitest-environment jsdom

import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { TableMap } from '@tiptap/pm/tables';
import { describe, expect, it } from 'vitest';
import { getCellOffsetAtLogicalPosition } from '../../position/tableMapUtils';
import {
  findTableHorizontalScrollContainer,
  getTableDomElement,
  measureTableColumnWidths,
  measureTablePositionMetrics,
  measureTableRowHeights,
  type RectMetrics,
  type TableCoordinateHeaderEditor,
} from './tableCoordinateHeaderMetrics';

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

function createCell(
  text: string,
  attrs: { colspan?: number; rowspan?: number; colwidth?: number[] | null } | number[] | null = null
): ProseMirrorNode {
  const normalizedAttrs = Array.isArray(attrs) || attrs === null
    ? { colspan: 1, rowspan: 1, colwidth: attrs }
    : { colspan: 1, rowspan: 1, colwidth: null, ...attrs };

  return schema.nodes.tableCell.create(
    normalizedAttrs,
    schema.nodes.tableCellContentBlock.create(null, schema.text(text))
  );
}

function createDomRect(rect: RectMetrics): DOMRect {
  return {
    x: rect.left,
    y: rect.top,
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    width: rect.width,
    height: rect.height,
    toJSON: () => ({}),
  } as DOMRect;
}

function createEditorContext(rows: ProseMirrorNode[][]): {
  editor: TableCoordinateHeaderEditor;
  tableNode: ProseMirrorNode;
  tablePos: number;
  tableDom: HTMLElement;
  contentDom: HTMLElement;
} {
  const tableRows = rows.map((row) => schema.nodes.tableRow.create(null, row));
  const table = schema.nodes.table.create(null, tableRows);
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'root-table' }, table),
  ]);
  const state = EditorState.create({ schema, doc });

  let tablePos: number | null = null;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table' || tablePos !== null) return true;
    tablePos = pos;
    return false;
  });

  if (tablePos === null) {
    throw new Error('测试文档缺少 table');
  }

  const tableNode = state.doc.nodeAt(tablePos);
  if (!tableNode) {
    throw new Error('测试文档缺少 table node');
  }

  const editorDom = document.createElement('div');
  const rootBlock = document.createElement('div');
  rootBlock.className = 'root-block';
  const contentDom = document.createElement('div');
  contentDom.className = 'content';
  const tableDom = document.createElement('table');
  contentDom.appendChild(tableDom);
  rootBlock.appendChild(contentDom);
  editorDom.appendChild(rootBlock);
  document.body.appendChild(editorDom);

  const editor: TableCoordinateHeaderEditor = {
    view: {
      state,
      dom: editorDom,
      nodeDOM: (pos: number) => (pos === tablePos ? tableDom : null),
    },
  };

  return { editor, tableNode, tablePos, tableDom, contentDom };
}

function getCellDocPos(tableNode: ProseMirrorNode, tablePos: number, row: number, col: number): number {
  const map = TableMap.get(tableNode);
  const cellOffset = getCellOffsetAtLogicalPosition(map, row, col);
  if (cellOffset === null) {
    throw new Error(`无法定位测试单元格: row=${row}, col=${col}`);
  }
  return tablePos + 1 + cellOffset;
}

describe('tableCoordinateHeaderMetrics', () => {
  it('reads column widths from document colwidth before DOM measurement', () => {
    const context = createEditorContext([
      [createCell('a1', [120]), createCell('b1', [180])],
      [createCell('a2'), createCell('b2')],
    ]);

    const widths = measureTableColumnWidths({
      editor: context.editor,
      tablePos: context.tablePos,
      getCellRect: () => {
        throw new Error('存在 colwidth 时不应读取 DOM');
      },
    });

    expect(widths).toEqual([120, 180]);
  });

  it('reads per-column colwidth from a colspan cell', () => {
    const context = createEditorContext([
      [
        createCell('wide', { colspan: 2, colwidth: [110, 150] }),
        createCell('c1', [200]),
      ],
      [createCell('a2'), createCell('b2'), createCell('c2')],
    ]);

    const widths = measureTableColumnWidths({
      editor: context.editor,
      tablePos: context.tablePos,
      getCellRect: () => {
        throw new Error('存在 colwidth 时不应读取 DOM');
      },
    });

    expect(widths).toEqual([110, 150, 200]);
  });

  it('falls back to DOM rects when colwidth is absent', () => {
    const context = createEditorContext([
      [createCell('a1'), createCell('b1')],
      [createCell('a2'), createCell('b2')],
    ]);
    const firstCellPos = getCellDocPos(context.tableNode, context.tablePos, 0, 0);
    const secondCellPos = getCellDocPos(context.tableNode, context.tablePos, 0, 1);

    const widths = measureTableColumnWidths({
      editor: context.editor,
      tablePos: context.tablePos,
      getCellRect: (_editor, cellDocPos) => {
        if (cellDocPos === firstCellPos) return { left: 0, top: 0, width: 90, height: 24 };
        if (cellDocPos === secondCellPos) return { left: 90, top: 0, width: 150, height: 24 };
        return null;
      },
    });

    expect(widths).toEqual([90, 150]);
  });

  it('prefers a non-spanned DOM cell when measuring a column covered by colspan elsewhere', () => {
    const context = createEditorContext([
      [
        createCell('wide', { colspan: 2 }),
        createCell('c1'),
      ],
      [createCell('a2'), createCell('b2'), createCell('c2')],
    ]);
    const wideCellPos = getCellDocPos(context.tableNode, context.tablePos, 0, 0);
    const rowTwoFirstCellPos = getCellDocPos(context.tableNode, context.tablePos, 1, 0);
    const rowTwoSecondCellPos = getCellDocPos(context.tableNode, context.tablePos, 1, 1);
    const thirdColumnCellPos = getCellDocPos(context.tableNode, context.tablePos, 0, 2);

    const widths = measureTableColumnWidths({
      editor: context.editor,
      tablePos: context.tablePos,
      getCellRect: (_editor, cellDocPos) => {
        if (cellDocPos === wideCellPos) return { left: 0, top: 0, width: 260, height: 24 };
        if (cellDocPos === rowTwoFirstCellPos) return { left: 0, top: 24, width: 95, height: 24 };
        if (cellDocPos === rowTwoSecondCellPos) return { left: 95, top: 24, width: 165, height: 24 };
        if (cellDocPos === thirdColumnCellPos) return { left: 260, top: 0, width: 120, height: 24 };
        return null;
      },
    });

    expect(widths).toEqual([95, 165, 120]);
  });

  it('measures row heights from the first available cell in each row', () => {
    const context = createEditorContext([
      [createCell('a1'), createCell('b1')],
      [createCell('a2'), createCell('b2')],
    ]);
    const rowOneCell = getCellDocPos(context.tableNode, context.tablePos, 0, 0);
    const rowTwoCell = getCellDocPos(context.tableNode, context.tablePos, 1, 0);

    const heights = measureTableRowHeights({
      editor: context.editor,
      tablePos: context.tablePos,
      getCellRect: (_editor, cellDocPos) => {
        if (cellDocPos === rowOneCell) return { left: 0, top: 0, width: 90, height: 28 };
        if (cellDocPos === rowTwoCell) return { left: 0, top: 28, width: 90, height: 44 };
        return null;
      },
    });

    expect(heights).toEqual([28, 44]);
  });

  it('prefers a non-spanned DOM cell when measuring a row covered by rowspan elsewhere', () => {
    const context = createEditorContext([
      [
        createCell('tall', { rowspan: 2 }),
        createCell('b1'),
      ],
      [
        createCell('b2'),
      ],
    ]);
    const tallCellPos = getCellDocPos(context.tableNode, context.tablePos, 0, 0);
    const firstRowNormalCellPos = getCellDocPos(context.tableNode, context.tablePos, 0, 1);
    const secondRowNormalCellPos = getCellDocPos(context.tableNode, context.tablePos, 1, 1);

    const heights = measureTableRowHeights({
      editor: context.editor,
      tablePos: context.tablePos,
      getCellRect: (_editor, cellDocPos) => {
        if (cellDocPos === tallCellPos) return { left: 0, top: 0, width: 90, height: 80 };
        if (cellDocPos === firstRowNormalCellPos) return { left: 90, top: 0, width: 90, height: 28 };
        if (cellDocPos === secondRowNormalCellPos) return { left: 90, top: 28, width: 90, height: 44 };
        return null;
      },
    });

    expect(heights).toEqual([28, 44]);
  });

  it('calculates table position metrics against editor and table scroll containers', () => {
    const context = createEditorContext([[createCell('a1')]]);
    const pageContainer = document.createElement('div');
    const tableScroller = document.createElement('div');

    pageContainer.getBoundingClientRect = () =>
      createDomRect({ left: 10, top: 20, width: 600, height: 400 });
    context.tableDom.getBoundingClientRect = () =>
      createDomRect({ left: 30, top: 80, width: 500, height: 240 });
    tableScroller.getBoundingClientRect = () =>
      createDomRect({ left: 25, top: 70, width: 320, height: 240 });
    Object.defineProperty(pageContainer, 'offsetHeight', { value: 420 });
    Object.defineProperty(pageContainer, 'clientHeight', { value: 400 });
    Object.defineProperty(tableScroller, 'clientWidth', { value: 320 });

    const metrics = measureTablePositionMetrics({
      tableDom: context.tableDom,
      pageScrollContainer: pageContainer,
      tableScrollContainer: tableScroller,
      previousRect: { left: 20, top: 70, width: 480, height: 200 },
    });

    expect(metrics.containerRect).toEqual({ left: 10, top: 20 });
    expect(metrics.tableTopInContainer).toBe(60);
    expect(metrics.editorShellScrollbarHeight).toBe(20);
    expect(metrics.editorShellBottomInViewport).toBe(400);
    expect(metrics.tableVisibleWidth).toBe(320);
    expect(metrics.tableScrollContainerRect).toEqual({ left: 25, top: 70 });
    expect(metrics.delta).toEqual({ dx: 10, dy: 10, dw: 20, dh: 40 });
  });

  it('resolves table DOM and horizontal scroll container through the root block content', () => {
    const context = createEditorContext([[createCell('a1')]]);

    expect(getTableDomElement(context.editor, context.tablePos)).toBe(context.tableDom);
    expect(findTableHorizontalScrollContainer(context.editor, context.tablePos)).toBe(context.contentDom);
  });
});
