// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import { insertOrAppendTextInCell } from './tableCellWriter';

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
        rowspan: cellNode.attrs.rowspan,
      });
    });
    rows.push(row);
  });

  return rows;
}

function createEditor() {
  let state = EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, [
      schema.nodes.rootBlock.create(
        { id: 'root-table' },
        schema.nodes.table.create(null, [
          schema.nodes.tableRow.create(null, [
            cell('tall', { rowspan: 2 }),
            cell('b1'),
          ]),
          schema.nodes.tableRow.create(null, [
            cell('b2'),
          ]),
        ])
      ),
    ]),
  });

  const view = {
    editable: true,
    dispatch: vi.fn((tr) => {
      state = state.apply(tr);
    }),
  };

  return {
    editor: {
      get state() {
        return state;
      },
      view,
    },
    get state() {
      return state;
    },
  };
}

describe('tableCellWriter', () => {
  it('writes to the physical cell that covers a logical rowspan coordinate', () => {
    const fixture = createEditor();
    const { tableNode, tablePos } = findTable(fixture.state.doc);

    expect(insertOrAppendTextInCell(
      fixture.editor,
      tableNode,
      tablePos,
      1,
      0,
      'filled',
      false
    )).toBe(true);

    expect(readPhysicalRows(fixture.state.doc)).toEqual([
      [
        { text: 'filled', colspan: 1, rowspan: 2 },
        { text: 'b1', colspan: 1, rowspan: 1 },
      ],
      [
        { text: 'b2', colspan: 1, rowspan: 1 },
      ],
    ]);
  });
});
