// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import {
  buildTableCellContentNormalizationTransaction,
  collectTableCellContentNormalizationTargets,
  createNormalizedTableCellContentBlock,
  dispatchTableCellContentNormalization,
} from './tableCellContentNormalization';

const schema = new Schema({
  nodes: {
    doc: { content: 'table' },
    text: { group: 'inline' },
    paragraph: {
      group: 'block',
      content: 'text*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    table: {
      content: 'tableRow+',
      tableRole: 'table',
      toDOM: () => ['table', ['tbody', 0]],
      parseDOM: [{ tag: 'table' }],
    },
    tableRow: {
      content: '(tableCell | tableHeader)+',
      tableRole: 'row',
      toDOM: () => ['tr', 0],
      parseDOM: [{ tag: 'tr' }],
    },
    tableCell: {
      content: 'block*',
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
      content: 'block*',
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
      group: 'block',
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

function idSequence(ids) {
  let index = 0;
  return () => ids[index++] || `generated-${index}`;
}

function paragraph(text) {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : null);
}

function contentBlock(id, text, attrs = {}) {
  return schema.nodes.tableCellContentBlock.create(
    { id, blockType: 'tableCellContent', ...attrs },
    text ? schema.text(text) : null
  );
}

function cell(children = []) {
  return schema.nodes.tableCell.create(
    { colspan: 1, rowspan: 1, colwidth: null },
    children
  );
}

function headerCell(children = []) {
  return schema.nodes.tableHeader.create(
    { colspan: 1, rowspan: 1, colwidth: null },
    children
  );
}

function createStateFromRows(rows) {
  const tableRows = rows.map((row) => schema.nodes.tableRow.create(null, row));
  const doc = schema.nodes.doc.create(null, schema.nodes.table.create(null, tableRows));
  return EditorState.create({ schema, doc });
}

function readCells(doc) {
  const rows = [];
  doc.firstChild.forEach((rowNode) => {
    const row = [];
    rowNode.forEach((cellNode) => {
      row.push({
        childCount: cellNode.childCount,
        firstType: cellNode.firstChild?.type.name || null,
        firstId: cellNode.firstChild?.attrs.id || null,
        firstBlockType: cellNode.firstChild?.attrs.blockType || null,
        text: cellNode.textContent,
      });
    });
    rows.push(row);
  });
  return rows;
}

describe('tableCellContentNormalization', () => {
  it('skips cells that already have one valid tableCellContentBlock', () => {
    const normalized = createNormalizedTableCellContentBlock({
      schema,
      cellNode: cell([contentBlock('stable-id', 'Alpha')]),
      createId: () => 'unused',
    });

    expect(normalized).toBeNull();
  });

  it('normalizes missing content block attrs without changing cell text', () => {
    const normalized = createNormalizedTableCellContentBlock({
      schema,
      cellNode: cell([contentBlock(null, 'Alpha', { blockType: null })]),
      createId: () => 'created-id',
    });

    expect(normalized.reason).toBe('content-block-attrs');
    expect(normalized.contentBlock.attrs.id).toBe('created-id');
    expect(normalized.contentBlock.attrs.blockType).toBe('tableCellContent');
    expect(normalized.contentBlock.textContent).toBe('Alpha');
  });

  it('wraps non-standard children into a single semantic content block', () => {
    const normalized = createNormalizedTableCellContentBlock({
      schema,
      cellNode: cell([
        paragraph('Alpha'),
        contentBlock('existing-id', 'Beta', { blockType: null }),
        paragraph('Gamma'),
      ]),
      createId: () => 'unused',
    });

    expect(normalized.reason).toBe('wrapped-non-content-children');
    expect(normalized.contentBlock.attrs.id).toBe('existing-id');
    expect(normalized.contentBlock.attrs.blockType).toBe('tableCellContent');
    expect(normalized.contentBlock.textContent).toBe('Alpha Beta Gamma');
  });

  it('builds one bottom-up transaction for empty, wrapped, aggregated, and header cells', () => {
    const state = createStateFromRows([
      [
        cell([]),
        cell([paragraph('Legacy'), paragraph('Cell')]),
      ],
      [
        cell([contentBlock('a1', 'Alpha'), contentBlock('a2', 'Beta')]),
        headerCell([contentBlock(null, 'Header', { blockType: null })]),
      ],
    ]);

    const normalization = buildTableCellContentNormalizationTransaction(state, {
      createId: idSequence(['empty-id', 'legacy-id', 'merged-id', 'header-id']),
    });

    expect(normalization.count).toBe(4);
    expect(normalization.reasons).toEqual([
      'empty-cell',
      'wrapped-non-content-children',
      'multiple-content-blocks',
      'content-block-attrs',
    ]);
    expect(normalization.tr.getMeta('normalizedTableCellContent')).toBe(true);
    expect(normalization.tr.getMeta('normalizedTableCellContentCount')).toBe(4);

    const nextState = state.apply(normalization.tr);
    expect(readCells(nextState.doc)).toEqual([
      [
        {
          childCount: 1,
          firstType: 'tableCellContentBlock',
          firstId: 'empty-id',
          firstBlockType: 'tableCellContent',
          text: '',
        },
        {
          childCount: 1,
          firstType: 'tableCellContentBlock',
          firstId: 'legacy-id',
          firstBlockType: 'tableCellContent',
          text: 'Legacy Cell',
        },
      ],
      [
        {
          childCount: 1,
          firstType: 'tableCellContentBlock',
          firstId: 'merged-id',
          firstBlockType: 'tableCellContent',
          text: 'Alpha Beta',
        },
        {
          childCount: 1,
          firstType: 'tableCellContentBlock',
          firstId: 'header-id',
          firstBlockType: 'tableCellContent',
          text: 'Header',
        },
      ],
    ]);
  });

  it('dispatches normalization against the latest editor state', () => {
    let state = createStateFromRows([
      [cell([paragraph('Needs'), paragraph('Normalize')])],
    ]);
    const dispatch = vi.fn((tr) => {
      state = state.apply(tr);
    });
    const editor = {
      get state() {
        return state;
      },
      view: { dispatch },
    };

    expect(dispatchTableCellContentNormalization(editor, {
      createId: () => 'normalized-id',
    })).toBe(true);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(collectTableCellContentNormalizationTargets(state)).toHaveLength(0);
    expect(readCells(state.doc)[0][0]).toEqual({
      childCount: 1,
      firstType: 'tableCellContentBlock',
      firstId: 'normalized-id',
      firstBlockType: 'tableCellContent',
      text: 'Needs Normalize',
    });
  });
});
