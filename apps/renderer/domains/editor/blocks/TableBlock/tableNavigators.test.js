// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import { navigateIntoTable } from './tableNavigators';
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

function findRequiredNodePosition(doc, nodeName) {
  let foundPos = null;

  doc.descendants((node, pos) => {
    if (node.type.name !== nodeName || foundPos !== null) return true;
    foundPos = pos;
    return false;
  });

  if (foundPos === null) {
    throw new Error(`测试文档缺少节点: ${nodeName}`);
  }

  return foundPos;
}

function waitMicrotask() {
  return Promise.resolve();
}

function createCell(text, attrs = {}) {
  const tableCellContent = schema.nodes.tableCellContentBlock.create(null, text ? schema.text(text) : null);
  return schema.nodes.tableCell.create(
    { colspan: 1, rowspan: 1, colwidth: null, ...attrs },
    tableCellContent
  );
}

function normalizeCell(cellValue) {
  if (cellValue && typeof cellValue === 'object' && cellValue.type === schema.nodes.tableCell) {
    return cellValue;
  }

  return createCell(cellValue);
}

function createTableNavigationContext(rows = [['cell']]) {
  const tableRows = rows.map((row) => schema.nodes.tableRow.create(null, row.map(normalizeCell)));
  const table = schema.nodes.table.create(null, tableRows);
  const rootBlock = schema.nodes.rootBlock.create({ id: 'root-table' }, table);
  const doc = schema.nodes.doc.create(null, [rootBlock]);

  let state = EditorState.create({ schema, doc });
  const rootDom = document.createElement('div');
  const focus = vi.fn(() => true);
  const view = {
    get state() {
      return state;
    },
    dispatch(tr) {
      state = state.apply(tr);
    },
    nodeDOM() {
      return rootDom;
    },
  };
  const editor = {
    get state() {
      return state;
    },
    view,
    commands: { focus },
  };
  const event = {
    preventDefault: vi.fn(),
  };

  return {
    editor,
    event,
    get state() {
      return state;
    },
    context: {
      editor,
      view,
      get state() {
        return state;
      },
      dispatch: view.dispatch.bind(view),
      event,
    },
    blockInfo: {
      contentNode: table,
      nodePos: findRequiredNodePosition(doc, 'table'),
    },
    focus,
  };
}

function getCellPositions(state, rowIndex, colIndex) {
  const tablePos = findRequiredNodePosition(state.doc, 'table');
  const tableNode = state.doc.nodeAt(tablePos);
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
    throw new Error(`无法解析单元格内容位置: row=${rowIndex}, col=${colIndex}`);
  }

  return {
    cellPos,
    cellNode,
    ...positions,
  };
}

describe('tableNavigators', () => {
  it('enters a table through the render virtualization selection handshake', async () => {
    const testContext = createTableNavigationContext();
    const targetPos = getCellPositions(testContext.state, 0, 0).contentStart;

    const handled = navigateIntoTable(testContext.context, testContext.blockInfo, 'start');
    expect(handled).toBe(true);
    expect(testContext.event.preventDefault).toHaveBeenCalledTimes(1);

    await waitMicrotask();
    await waitMicrotask();

    expect(testContext.state.selection.from).toBe(targetPos);
    expect(testContext.focus).toHaveBeenCalledTimes(1);
  });

  it('enters the bottom-right logical cell even when it is covered by rowspan', async () => {
    const testContext = createTableNavigationContext([
      ['a1', createCell('span', { rowspan: 2 })],
      ['a2'],
    ]);
    const targetPos = getCellPositions(testContext.state, 1, 1).contentEnd;

    const handled = navigateIntoTable(testContext.context, testContext.blockInfo, 'end');
    expect(handled).toBe(true);
    expect(testContext.event.preventDefault).toHaveBeenCalledTimes(1);

    await waitMicrotask();
    await waitMicrotask();

    expect(testContext.state.selection.from).toBe(targetPos);
    expect(testContext.focus).toHaveBeenCalledTimes(1);
  });
});
