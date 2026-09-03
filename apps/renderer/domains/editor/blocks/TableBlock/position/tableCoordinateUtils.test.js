// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import {
  getCellPosByCoordinate,
  getColumnHeaders,
} from './tableCoordinateUtils';

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

function createTableContext(rows) {
  const table = schema.nodes.table.create(
    null,
    rows.map((row) => schema.nodes.tableRow.create(null, row))
  );
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.rootBlock.create({ id: 'root-table' }, table),
  ]);

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

describe('tableCoordinateUtils', () => {
  it('resolves an Excel coordinate to the physical cell covering that logical coordinate', () => {
    const { tableNode, tablePos } = createTableContext([
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

    const firstLogicalColumn = getCellPosByCoordinate(tableNode, tablePos, 'A1');
    const secondLogicalColumn = getCellPosByCoordinate(tableNode, tablePos, 'B1');
    const thirdLogicalColumn = getCellPosByCoordinate(tableNode, tablePos, 'C1');

    expect(secondLogicalColumn).toBe(firstLogicalColumn);
    expect(thirdLogicalColumn).not.toBe(firstLogicalColumn);
    expect(tableNode.nodeAt(secondLogicalColumn - tablePos - 1).textContent).toBe('wide');
  });

  it('uses the covering header cell for each logical column', () => {
    const { tableNode } = createTableContext([
      [
        cell('产品信息', { colspan: 2 }),
        cell('价格'),
      ],
      [
        cell('名称'),
        cell('颜色'),
        cell('金额'),
      ],
    ]);

    expect(getColumnHeaders(tableNode)).toEqual({
      0: '产品信息',
      1: '产品信息',
      2: '价格',
    });
  });
});
