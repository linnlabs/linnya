import Database from 'better-sqlite3';
import { expect, it, vi } from 'vitest';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasSnapshot } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';
import { createCanvasPlainTextDocument } from '../../../../shared';
import { readCanvasAgentGroups } from '..';

it('reviews a user batch once per Agent group and preserves the later user work on withdrawal', () => {
  const database = new Database(':memory:');
  try {
    database.pragma('foreign_keys = ON');
    database.exec('CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY)');
    for (const migration of canvasPluginMigrations) migration.up(database);
    database.prepare('INSERT INTO workspace_nodes VALUES (?)').run('doc');
    initializeCanvasDocument(database, 'doc');
    const history = createCanvasHistoryRuntime({ database });
    const count = 500;
    history.commitAgent({ actor: { source: { kind: 'agent', conversationId: 'A', runId: 'a' }, viewId: 'agent' }, now: 1,
      request: { documentId: 'doc', requestId: 'add-batch', operations: Array.from({ length: count }, () => ({
        op: 'addText', content: createCanvasPlainTextDocument('Agent创建的文字卡'), width: 240, height: 120,
      })) } });
    const cards = readCanvasSnapshot(database, 'doc').elements;
    const queries = vi.spyOn(database, 'prepare');
    history.commit({ actor: { source: { kind: 'user', conversationId: null, runId: null }, viewId: 'user' }, now: 2,
      request: { documentId: 'doc', requestId: 'user-drag', operations: cards.map(card => ({
        op: 'update', id: card.id, baseRevision: card.revision, patch: { x: card.x + 40 },
      })) } });
    const groupWrites = queries.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO canvas_agent_groups')).length;
    queries.mockRestore();
    expect(groupWrites).toBe(1);
    const group = readCanvasAgentGroups(database, 'doc')[0];
    expect(new Set(group.reviewedElementIds)).toEqual(new Set(cards.map(card => card.id)));
    const restarted = createCanvasHistoryRuntime({ database });
    restarted.withdraw({ documentId: 'doc', groupId: group.id, requestId: 'withdraw', viewId: 'user' }, 3);
    expect(readCanvasSnapshot(database, 'doc').elements.map(card => [card.id, card.x]))
      .toEqual(cards.map(card => [card.id, card.x + 40]));
  } finally { database.close(); }
}, 30_000);
