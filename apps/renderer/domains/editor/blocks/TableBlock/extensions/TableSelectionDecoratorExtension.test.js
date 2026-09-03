// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import {
  COLUMN_REFS_DECORATOR_KEY,
  TABLE_SELECTION_DECORATOR_KEY,
  TableSelectionDecoratorExtension,
  setColumnRefs,
} from './TableSelectionDecoratorExtension';

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

function createRootBlock(id, rows) {
  const table = schema.nodes.table.create(
    null,
    rows.map((row) => schema.nodes.tableRow.create(null, row))
  );

  return schema.nodes.rootBlock.create({ id }, table);
}

function createDocFromRootBlocks(rootBlocks) {
  return schema.nodes.doc.create(null, rootBlocks);
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

function findTableByRootBlockId(doc, rootBlockId) {
  let tableNode = null;
  let tablePos = null;

  doc.descendants((node, pos) => {
    if (node.type.name !== 'rootBlock' || node.attrs.id !== rootBlockId) return true;

    node.descendants((child, relativePos) => {
      if (tableNode) return false;
      if (child.type.name !== 'table') return true;
      tableNode = child;
      tablePos = pos + 1 + relativePos;
      return false;
    });
    return false;
  });

  if (!tableNode || tablePos === null) {
    throw new Error(`测试文档缺少 table: ${rootBlockId}`);
  }

  return { tableNode, tablePos };
}

function createState(doc) {
  const plugins = TableSelectionDecoratorExtension.config.addProseMirrorPlugins.call({
    editor: {},
  });

  return {
    plugins,
    state: EditorState.create({ schema, doc, plugins }),
  };
}

function getSelectionDecoratorState(state, plugins) {
  return plugins[0].getState(state);
}

function getColumnRefsDecoratorState(state, plugins) {
  return plugins[1].getState(state);
}

function getClassName(decoration) {
  return decoration.type.attrs.class;
}

describe('TableSelectionDecoratorExtension', () => {
  it('deduplicates selection decorations for a colspan cell and keeps both logical edges', () => {
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
    const { tableNode, tablePos } = findTable(doc);
    const context = createState(doc);

    const tr = context.state.tr.setMeta(TABLE_SELECTION_DECORATOR_KEY, {
      keepSelectionVisible: true,
      originalRect: { top: 0, bottom: 1, left: 0, right: 2 },
      tableNode,
      tablePos,
      suppressOutputCalc: true,
    });
    context.state = context.state.apply(tr);

    const decorations = getSelectionDecoratorState(context.state, context.plugins).decorations.find();
    expect(decorations).toHaveLength(1);
    expect(getClassName(decorations[0])).toContain('ai-outline-left');
    expect(getClassName(decorations[0])).toContain('ai-outline-right');
  });

  it('deduplicates column ref decorations for a rowspan cell and keeps both vertical edges', () => {
    const doc = createDoc([
      [
        cell('tall', { rowspan: 2 }),
        cell('b1'),
      ],
      [
        cell('b2'),
      ],
    ]);
    const { tableNode, tablePos } = findTable(doc);
    const context = createState(doc);

    const tr = setColumnRefs(context.state.tr, {
      name: {
        id: 'name',
        active: true,
        color: '#1d4ed8',
        rect: { top: 0, bottom: 2, left: 0, right: 1 },
      },
    }, { node: tableNode, pos: tablePos });
    expect(tr.getMeta(COLUMN_REFS_DECORATOR_KEY)).toBeTruthy();
    context.state = context.state.apply(tr);

    const decorations = getColumnRefsDecoratorState(context.state, context.plugins).decorations.find();
    expect(decorations).toHaveLength(1);
    expect(getClassName(decorations[0])).toContain('ai-column-ref-top');
    expect(getClassName(decorations[0])).toContain('ai-column-ref-bottom');
  });

  it('keeps each active column reference color on its own cell decorations', () => {
    const doc = createDoc([
      [cell('a1'), cell('b1')],
      [cell('a2'), cell('b2')],
    ]);
    const { tableNode, tablePos } = findTable(doc);
    const context = createState(doc);

    context.state = context.state.apply(setColumnRefs(context.state.tr, {
      A: {
        id: 'ref-A',
        active: true,
        color: '#66BB6A',
        rect: { top: 0, bottom: 2, left: 0, right: 1 },
      },
      B: {
        id: 'ref-B',
        active: true,
        color: '#AB47BC',
        rect: { top: 0, bottom: 2, left: 1, right: 2 },
      },
    }, { node: tableNode, pos: tablePos }));

    const decorations = getColumnRefsDecoratorState(context.state, context.plugins).decorations.find();
    const styles = new Set(decorations.map(decoration => decoration.type.attrs.style));

    expect(decorations).toHaveLength(4);
    expect(styles).toEqual(new Set([
      '--table-ai-column-ref-color: #66BB6A;',
      '--table-ai-column-ref-color: #AB47BC;',
    ]));
  });

  it('remaps column ref tableInfo through document changes before the table', () => {
    const initialDoc = createDocFromRootBlocks([
      createRootBlock('target-table', [
        [cell('a1'), cell('b1')],
      ]),
    ]);
    const { tableNode, tablePos } = findTable(initialDoc);
    const context = createState(initialDoc);

    context.state = context.state.apply(setColumnRefs(context.state.tr, {
      name: {
        id: 'name',
        active: true,
        color: '#1d4ed8',
        rect: { top: 0, bottom: 1, left: 0, right: 1 },
      },
    }, { node: tableNode, pos: tablePos, rootBlockId: 'target-table' }));

    const insertedRootBlock = createRootBlock('inserted-before', [[cell('before')]]);
    context.state = context.state.apply(context.state.tr.insert(0, insertedRootBlock));

    const pluginState = getColumnRefsDecoratorState(context.state, context.plugins);
    const latestTable = findTableByRootBlockId(context.state.doc, 'target-table');

    expect(pluginState.tableInfo.pos).toBe(latestTable.tablePos);
    expect(pluginState.tableInfo.node).toBe(latestTable.tableNode);
    expect(pluginState.tableInfo.rootBlockId).toBe('target-table');
    expect(pluginState.decorations.find()).toHaveLength(1);
  });
});
