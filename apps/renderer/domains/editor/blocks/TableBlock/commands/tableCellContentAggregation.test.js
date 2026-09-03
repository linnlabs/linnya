// @vitest-environment jsdom

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { describe, expect, it, vi } from 'vitest';
import {
  buildTableCellContentAggregationTransaction,
  collectTableCellContentAggregationTargets,
  createAggregatedTableCellContentBlock,
  dispatchTableCellContentAggregation,
} from './tableCellContentAggregation';

const schema = new Schema({
  nodes: {
    doc: { content: 'table' },
    text: { group: 'inline' },
    table: {
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
      content: 'tableCellContentBlock+',
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
      content: 'tableCellContentBlock+',
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

function contentBlock(id, text) {
  const content = text ? schema.text(text) : null;
  return schema.nodes.tableCellContentBlock.create(
    { id, blockType: 'tableCellContent' },
    content
  );
}

function cell(blocks) {
  return schema.nodes.tableCell.create(
    { colspan: 1, rowspan: 1, colwidth: null },
    blocks
  );
}

function tableWithRows(rows) {
  return schema.nodes.table.create(
    null,
    rows.map((row) => schema.nodes.tableRow.create(null, row))
  );
}

function createState() {
  return EditorState.create({
    schema,
    doc: schema.nodes.doc.create(null, tableWithRows([
      [
        cell([contentBlock('a1', 'Alpha'), contentBlock('a2', 'Beta')]),
        cell([contentBlock('b1', 'Single')]),
      ],
      [
        cell([contentBlock('c1', 'Gamma'), contentBlock('c2', ' Delta')]),
        cell([contentBlock('d1', 'Tail')]),
      ],
    ])),
  });
}

function readCellTexts(doc) {
  const rows = [];
  doc.firstChild.forEach((rowNode) => {
    const row = [];
    rowNode.forEach((cellNode) => {
      row.push({
        childCount: cellNode.childCount,
        text: cellNode.textContent,
        firstBlockId: cellNode.firstChild.attrs.id,
      });
    });
    rows.push(row);
  });
  return rows;
}

describe('tableCellContentAggregation', () => {
  it('aggregates multiple tableCellContentBlock children into a single semantic content block', () => {
    const aggregated = createAggregatedTableCellContentBlock({
      schema,
      cellNode: cell([
        contentBlock('old-1', 'Alpha'),
        contentBlock('old-2', 'Beta'),
        contentBlock('old-3', ' Gamma'),
      ]),
      createId: () => 'merged-cell-content',
    });

    expect(aggregated.type.name).toBe('tableCellContentBlock');
    expect(aggregated.attrs.id).toBe('merged-cell-content');
    expect(aggregated.textContent).toBe('Alpha Beta Gamma');
  });

  it('skips cells that already have a single content block', () => {
    const state = createState();
    const singleCell = state.doc.firstChild.child(0).child(1);

    expect(createAggregatedTableCellContentBlock({
      schema,
      cellNode: singleCell,
      createId: () => 'unused',
    })).toBeNull();
  });

  it('builds one transaction that aggregates every affected cell from bottom to top', () => {
    const state = createState();
    const aggregation = buildTableCellContentAggregationTransaction(state, {
      createId: () => 'merged',
    });

    expect(aggregation.count).toBe(2);
    expect(aggregation.tr.getMeta('aggregatedCellContent')).toBe(true);
    expect(aggregation.tr.getMeta('aggregatedCellContentCount')).toBe(2);

    const nextState = state.apply(aggregation.tr);
    expect(readCellTexts(nextState.doc)).toEqual([
      [
        { childCount: 1, text: 'Alpha Beta', firstBlockId: 'merged' },
        { childCount: 1, text: 'Single', firstBlockId: 'b1' },
      ],
      [
        { childCount: 1, text: 'Gamma Delta', firstBlockId: 'merged' },
        { childCount: 1, text: 'Tail', firstBlockId: 'd1' },
      ],
    ]);
  });

  it('dispatches aggregation through the latest editor state', () => {
    let state = createState();
    const dispatch = vi.fn((tr) => {
      state = state.apply(tr);
    });
    const editor = {
      get state() {
        return state;
      },
      view: { dispatch },
    };

    expect(dispatchTableCellContentAggregation(editor, {
      createId: () => 'merged',
    })).toBe(true);

    expect(dispatch).toHaveBeenCalledOnce();
    expect(collectTableCellContentAggregationTargets(state)).toHaveLength(0);
    expect(readCellTexts(state.doc)[0][0]).toEqual({
      childCount: 1,
      text: 'Alpha Beta',
      firstBlockId: 'merged',
    });
  });
});
