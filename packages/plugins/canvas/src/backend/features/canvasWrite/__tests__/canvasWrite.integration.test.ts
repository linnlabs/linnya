import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { parseMarkdownDocument } from '@linnya/markdown-document-core';
import { CanvasTextDocumentSchema, createCanvasPlainTextDocument } from '../../../../shared';
import { CanvasCliBatchSchema } from '../../../../shared/cli/definitions/canvasCli';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasSnapshot, commitCanvasOperations } from '../../canvasCommit';
import { prepareCanvasWrite, type CanvasWritePorts } from '../index';

it('measures a 300-card batch once and places against the final transaction state without overlaps', async () => {
  const db = new Database(':memory:'); db.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
  for (const migration of canvasPluginMigrations) migration.up(db);
  db.prepare('INSERT INTO workspace_nodes VALUES (?)').run('canvas'); initializeCanvasDocument(db, 'canvas');
  let calls = 0;
  const ports: CanvasWritePorts = {
    parseText: async text => CanvasTextDocumentSchema.parse(parseMarkdownDocument(text)),
    resolveDocument: async () => { throw new Error('not a document task'); }, prepareImage: async () => { throw new Error('not an image task'); },
    measure: async cards => { calls++; return cards.map(card => ({ ref: card.ref, height: 110 })); },
  };
  const operations = CanvasCliBatchSchema.parse(Array.from({ length: 300 }, (_, index) => ({ op: 'add', text: `## 发现 ${index}\n正文`, ref: `$n${index}` })));
  const prepared = await prepareCanvasWrite({ snapshot: readCanvasSnapshot(db, 'canvas'), operations, dryRun: false, signal: new AbortController().signal }, ports);
  const actor = { viewId: 'agent', source: { kind: 'agent' as const, conversationId: 'chat', runId: 'run' } };
  // 准备之后另一来源先占位；新卡必须在事务中避开它，不使用准备阶段的陈旧坐标。
  commitCanvasOperations({ database: db, actor: { ...actor, source: { ...actor.source, kind: 'user' } }, now: 1,
    request: { documentId: 'canvas', requestId: 'user', operations: [{ op: 'addText', width: 500, height: 300, content: createCanvasPlainTextDocument('先占位') }] } });
  commitCanvasOperations({ database: db, actor, now: 2, request: { documentId: 'canvas', requestId: 'batch', operations: prepared.operations } });
  const cards = readCanvasSnapshot(db, 'canvas').elements.filter(element => element.type !== 'edge');
  expect(calls).toBe(1); expect(cards).toHaveLength(301);
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i], b = cards[j]; expect(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y).toBe(false);
  }
  db.close();
});
it('preserves fixed text height while updating Markdown and reports an indexed wrong-type edit', async () => {
  const { CanvasSnapshotSchema } = await import('../../../../shared');
  const snapshot = CanvasSnapshotSchema.parse({ schemaVersion: 1, documentId: 'canvas', sequence: 1, elements: [{
    id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null },
    createdAt: 1, updatedAt: 1, x: 0, y: 0, width: 240, height: 200, parentId: null, data: { contentVersion: 1, heightMode: 'fixed', content: createCanvasPlainTextDocument('原文') },
  }] });
  let measured = false;
  const ports: CanvasWritePorts = { parseText: async text => CanvasTextDocumentSchema.parse(parseMarkdownDocument(text)),
    resolveDocument: async () => '', prepareImage: async () => ({ assetId: '', width: 1, height: 1 }), measure: async () => { measured = true; return []; } };
  const input = { snapshot, dryRun: false, signal: new AbortController().signal };
  const result = await prepareCanvasWrite({ ...input, operations: CanvasCliBatchSchema.parse([{ op: 'update', id: 'c1', revision: 1, append: '追加' }]) }, ports);
  expect(measured).toBe(false); expect(result.operations[0]).toMatchObject({ op: 'update', patch: { data: { heightMode: 'fixed' } } });
  await expect(prepareCanvasWrite({ ...input, operations: CanvasCliBatchSchema.parse([{ op: 'update', id: 'c1', revision: 1, caption: '错误字段' }]) }, ports)).rejects.toMatchObject({ code: 'wrong_element_type', operation: 0 });
});
