import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import {
  findTableIdentityAtPosition,
  findTableIdentityByRootBlockId,
  refreshTableInfoSnapshot,
} from './tableIdentity';

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
      content: 'text*',
      tableRole: 'cell',
      toDOM: () => ['td', 0],
      parseDOM: [{ tag: 'td' }],
    },
  },
});

function createRootBlock(id: string, text: string) {
  return schema.nodes.rootBlock.create(
    { id },
    schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [
        schema.nodes.tableCell.create(null, schema.text(text)),
      ]),
    ])
  );
}

function findTablePosByRootBlockId(doc: ProseMirrorNode, rootBlockId: string): number {
  let tablePos: number | null = null;

  doc.descendants((node, pos) => {
    if (node.type.name !== 'rootBlock' || node.attrs.id !== rootBlockId) return true;
    node.descendants((child, relativePos) => {
      if (tablePos !== null) return false;
      if (child.type.name !== 'table') return true;
      tablePos = pos + 1 + relativePos;
      return false;
    });
    return false;
  });

  if (tablePos === null) {
    throw new Error(`测试文档缺少 table: ${rootBlockId}`);
  }

  return tablePos;
}

describe('tableIdentity', () => {
  it('resolves a table identity from a table position', () => {
    const doc = schema.nodes.doc.create(null, [createRootBlock('root-table', 'cell')]);
    const tablePos = findTablePosByRootBlockId(doc, 'root-table');

    const identity = findTableIdentityAtPosition(doc, tablePos);

    expect(identity?.pos).toBe(tablePos);
    expect(identity?.node).toBe(doc.nodeAt(tablePos));
    expect(identity?.rootBlockId).toBe('root-table');
  });

  it('refreshes a stale table position through the stable rootBlock id', () => {
    const oldDoc = schema.nodes.doc.create(null, [createRootBlock('target-table', 'target')]);
    const newDoc = schema.nodes.doc.create(null, [
      createRootBlock('inserted-before', 'before'),
      createRootBlock('target-table', 'target'),
    ]);
    const stalePos = findTablePosByRootBlockId(oldDoc, 'target-table');
    const latestPos = findTablePosByRootBlockId(newDoc, 'target-table');

    const refreshed = refreshTableInfoSnapshot(newDoc, {
      node: oldDoc.nodeAt(stalePos),
      pos: stalePos,
      rootBlockId: 'target-table',
    });

    expect(refreshed?.pos).toBe(latestPos);
    expect(refreshed?.node).toBe(newDoc.nodeAt(latestPos));
    expect(refreshed?.rootBlockId).toBe('target-table');
  });

  it('falls back to position for legacy tableInfo without rootBlock id', () => {
    const doc = schema.nodes.doc.create(null, [createRootBlock('root-table', 'cell')]);
    const tablePos = findTablePosByRootBlockId(doc, 'root-table');

    expect(findTableIdentityByRootBlockId(doc, null)).toBeNull();
    expect(refreshTableInfoSnapshot(doc, { pos: tablePos })?.node).toBe(doc.nodeAt(tablePos));
  });
});
