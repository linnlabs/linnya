import Database from 'better-sqlite3';
import fc from 'fast-check';
import { expect, it } from 'vitest';
import { createCanvasPlainTextDocument, type CanvasColor } from '../../../../shared';
import { canvasPluginMigrations } from '../../../persistence/migrations';
import { initializeCanvasDocument, readCanvasSnapshot, validateCanvasGraph, type CanvasCommitActor } from '../../canvasCommit';
import { createCanvasHistoryRuntime } from '../../../orchestration/history/createCanvasHistoryRuntime';

const colors: readonly CanvasColor[] = ['white', 'red', 'orange', 'yellow', 'green', 'cyan', 'purple'];
const step = fc.record({ source: fc.constantFrom('user', 'A', 'B'), field: fc.constantFrom('color', 'label'), value: fc.integer({ min: 0, max: 6 }) });
it('selectively withdraws arbitrary interleaved fields and undoes/redoes only that user action', () => {
  fc.assert(fc.property(fc.array(step, { minLength: 1, maxLength: 24 }), actions => {
    fc.pre(actions.some(action => action.source === 'A'));
    const database = new Database(':memory:');
    database.exec("CREATE TABLE workspace_nodes(id TEXT PRIMARY KEY); INSERT INTO workspace_nodes VALUES ('canvas')");
    for (const migration of canvasPluginMigrations) migration.up(database);
    initializeCanvasDocument(database, 'canvas');
    const history = createCanvasHistoryRuntime({ database });
    const user: CanvasCommitActor = { viewId: 'view', source: { kind: 'user', conversationId: null, runId: null } };
    const add = { op: 'addText', width: 240, height: 120, content: createCanvasPlainTextDocument('字段交错') };
    const values = () => {
      const snapshot = readCanvasSnapshot(database, 'canvas'); validateCanvasGraph(snapshot.elements);
      const card = snapshot.elements.find(element => element.id === 'c1'), edge = snapshot.elements.find(element => element.id === 'e1');
      if (!card || !edge || edge.type !== 'edge') throw new Error('Required graph identities disappeared');
      return { color: card.color, label: edge.label };
    };
    try {
      history.commit({ actor: user, now: 1, request: { documentId: 'canvas', requestId: 'create', operations: [{ ...add, ref: '$a' }, { ...add, ref: '$b' }, { op: 'connect', from: '$a', to: '$b' }] } });
      for (const [index, action] of actions.entries()) {
        const id = action.field === 'color' ? 'c1' : 'e1';
        const element = readCanvasSnapshot(database, 'canvas').elements.find(candidate => candidate.id === id);
        if (!element) throw new Error('Missing selected identity');
        const request = { documentId: 'canvas', requestId: `step-${index}`, operations: [{ op: 'update', id, baseRevision: element.revision,
          patch: action.field === 'color' ? { color: colors[action.value] } : { label: `值${action.value}` } }] };
        if (action.source === 'user') history.commit({ actor: user, now: index + 2, request });
        else history.commitAgent({ actor: { viewId: action.source, source: { kind: 'agent', conversationId: action.source, runId: `run-${index}` } }, now: index + 2, request });
      }
      const before = values(); const sequence = readCanvasSnapshot(database, 'canvas').sequence;
      const group = history.listGroups('canvas', 100).find(candidate => candidate.conversationId === 'A');
      if (!group) throw new Error('Expected A change group');
      const expectedColor = actions.filter(action => action.source !== 'A' && action.field === 'color').at(-1);
      const expectedLabel = actions.filter(action => action.source !== 'A' && action.field === 'label').at(-1);
      const expected = { color: expectedColor ? colors[expectedColor.value] : 'white', label: expectedLabel ? `值${expectedLabel.value}` : '' };
      const withdrawal = history.withdraw({ documentId: 'canvas', viewId: 'view', groupId: group.id, requestId: 'withdraw-A' }, 100);
      expect(values()).toEqual(expected);
      if (withdrawal.commit.sequence === sequence) return;
      history.undo({ documentId: 'canvas', viewId: 'view', direction: 'undo', requestId: 'undo-withdraw' }, 101);
      expect(values()).toEqual(before);
      history.undo({ documentId: 'canvas', viewId: 'view', direction: 'redo', requestId: 'redo-withdraw' }, 102);
      expect(values()).toEqual(expected);
    } finally { database.close(); }
  }), { seed: 20261103, numRuns: 60 });
});
