import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { parseMarkdownDocument } from '@linnya/markdown-document-core';
import { CanvasTextDocumentSchema, CanvasSnapshotSchema, createCanvasPlainTextDocument } from '../../../../shared';
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
    resolveDocument: async () => '', prepareImage: async () => ({ assetId: '', displayWidth: 1, displayHeight: 1 }), measure: async () => { measured = true; return []; } };
  const input = { snapshot, dryRun: false, signal: new AbortController().signal };
  const result = await prepareCanvasWrite({ ...input, operations: CanvasCliBatchSchema.parse([{ op: 'update', id: 'c1', revision: 1, append: '追加' }]) }, ports);
  expect(measured).toBe(false); expect(result.operations[0]).toMatchObject({ op: 'update', patch: { data: { heightMode: 'fixed' } } });
  await expect(prepareCanvasWrite({ ...input, operations: CanvasCliBatchSchema.parse([{ op: 'update', id: 'c1', revision: 1, caption: '错误字段' }]) }, ports)).rejects.toMatchObject({ code: 'wrong_element_type', operation: 0 });
});
it('CLI预检与正式图片写入使用同一转正宽高，不按编码宽高测框', async () => {
  const dryRuns: boolean[] = [];
  const ports: CanvasWritePorts = { parseText: async () => createCanvasPlainTextDocument(''), resolveDocument: async () => '',
    prepareImage: async (_file, dryRun) => { dryRuns.push(dryRun); return { assetId: 'portrait', width: 120, height: 80, displayWidth: 80, displayHeight: 120 }; },
    measure: async () => { throw new Error('图片不走正文测高'); } };
  const snapshot = CanvasSnapshotSchema.parse({ schemaVersion: 1, documentId: 'canvas', sequence: 0, elements: [] });
  for (const dryRun of [true, false]) {
    const result = await prepareCanvasWrite({ snapshot, dryRun, signal: new AbortController().signal,
      operations: CanvasCliBatchSchema.parse([{ op: 'add', type: 'image', file: 'portrait.jpg', width: 240 }]) }, ports);
    expect(result.operations).toMatchObject([{ op: 'addImage', width: 240, height: 360, data: { assetId: 'portrait' } }]);
  }
  expect(dryRuns).toEqual([true, false]);
});

it('CLI原位改线保留身份和端点，样式后写生效但不覆盖用户新标签；省略样式不注入创建默认值', async () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
    for (const migration of canvasPluginMigrations) migration.up(db);
    db.prepare('INSERT INTO workspace_nodes VALUES (?)').run('canvas'); initializeCanvasDocument(db, 'canvas');
    const user = { viewId: 'user', source: { kind: 'user', conversationId: null, runId: null } } as const;
    const agent = { viewId: 'agent', source: { kind: 'agent', conversationId: 'chat', runId: 'run' } } as const;
    commitCanvasOperations({ database: db, actor: user, now: 1, request: { documentId: 'canvas', requestId: 'seed', operations: [
      { op: 'addText', ref: '$a', width: 240, height: 120, content: createCanvasPlainTextDocument('起点') },
      { op: 'addText', ref: '$b', width: 240, height: 120, content: createCanvasPlainTextDocument('终点') },
      { op: 'connect', from: '$a', to: '$b', label: '初始标签', direction: 'forward', lineStyle: 'curve', linePattern: 'solid' },
    ] } });
    const before = readCanvasSnapshot(db, 'canvas'), edge = before.elements.find(element => element.type === 'edge');
    if (!edge) throw new Error('Missing seeded edge');
    const ports: CanvasWritePorts = {
      parseText: async () => { throw new Error('改线不解析正文'); }, resolveDocument: async () => { throw new Error('改线不解析文档'); },
      prepareImage: async () => { throw new Error('改线不准入图片'); }, measure: async () => { throw new Error('改线不重新测高'); },
    };
    const prepared = await prepareCanvasWrite({ snapshot: before, dryRun: false, signal: new AbortController().signal,
      operations: CanvasCliBatchSchema.parse([{ op: 'update', id: edge.id, revision: edge.revision,
        label: '旧代理标签', direction: 'both', lineStyle: 'straight', linePattern: 'dashed' }]) }, ports);
    // 准备与提交之间用户只改标签；复用共同提交的字段规则，不另造CLI冲突策略。
    commitCanvasOperations({ database: db, actor: user, now: 2, request: { documentId: 'canvas', requestId: 'user-label',
      operations: [{ op: 'update', id: edge.id, baseRevision: edge.revision, patch: { label: '用户新标签' } }] } });
    const result = commitCanvasOperations({ database: db, actor: agent, now: 3,
      request: { documentId: 'canvas', requestId: 'edge-style', operations: prepared.operations } });
    expect(result.results[0]?.fieldResults?.filter(field => field.status === 'skipped'))
      .toEqual([{ field: 'label', status: 'skipped', reason: 'stale_field' }]);
    const styled = readCanvasSnapshot(db, 'canvas'), same = styled.elements.find(element => element.type === 'edge');
    if (!same) throw new Error('Missing updated edge');
    expect(same).toMatchObject({ id: edge.id, from: edge.from, to: edge.to, label: '用户新标签', direction: 'both', lineStyle: 'straight', linePattern: 'dashed' });
    const labelOnly = await prepareCanvasWrite({ snapshot: styled, dryRun: false, signal: new AbortController().signal,
      operations: CanvasCliBatchSchema.parse([{ op: 'update', id: same.id, revision: same.revision, label: '核对标签' }]) }, ports);
    commitCanvasOperations({ database: db, actor: agent, now: 4,
      request: { documentId: 'canvas', requestId: 'label-only', operations: labelOnly.operations } });
    const latest = readCanvasSnapshot(db, 'canvas');
    expect(latest.elements.filter(element => element.type === 'edge')).toMatchObject([
      { id: edge.id, from: edge.from, to: edge.to, label: '核对标签', direction: 'both', lineStyle: 'straight', linePattern: 'dashed' },
    ]);
    const card = latest.elements.find(element => element.type === 'text');
    if (!card) throw new Error('Missing seeded text card');
    await expect(prepareCanvasWrite({ snapshot: latest, dryRun: false, signal: new AbortController().signal,
      operations: CanvasCliBatchSchema.parse([
        { op: 'update', id: edge.id, revision: same.revision, label: '不能半写入' },
        { op: 'update', id: card.id, revision: card.revision, linePattern: 'solid' },
      ]) }, ports)).rejects.toMatchObject({ code: 'wrong_element_type', operation: 1 });
    expect(readCanvasSnapshot(db, 'canvas')).toEqual(latest);
  } finally { db.close(); }
});
