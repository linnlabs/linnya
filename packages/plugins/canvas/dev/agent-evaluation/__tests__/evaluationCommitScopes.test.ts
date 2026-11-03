import { expect, it } from 'vitest';
import { CanvasSynchronizationSchema, CanvasTextCardSchema, createCanvasPlainTextDocument } from '@plugin/canvas/shared';
import { readCanvasEvaluationCommitScopes } from '../readCanvasEvaluationCommitScopes';

it('合并补拉的多次提交按各自正式sequence归属，不把后来变化算给第一批', () => {
  const source = { kind: 'agent', conversationId: 'conversation', runId: 'run' };
  const card = CanvasTextCardSchema.parse({ id: 'c1', type: 'text', schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: source, updatedBy: source, createdAt: 0, updatedAt: 0, x: 0, y: 0, width: 280, height: 180, parentId: null, data: { contentVersion: 1, content: createCanvasPlainTextDocument('正文') } });
  const update = CanvasSynchronizationSchema.parse({ kind: 'delta', documentId: 'document', fromSequence: 0, sequence: 2, commits: [
    { sequence: 1, source, changes: [{ id: 'c1', before: null, after: card, fields: ['data'] }, { id: 'c1', before: card, after: { ...card, revision: 2, x: 100 }, fields: ['x'] }] },
    { sequence: 2, source, changes: [{ id: 'c1', before: card, after: null, fields: ['deleted'] }] },
  ] });
  expect(readCanvasEvaluationCommitScopes(update)).toEqual([
    { sequence: 1, cards: [{ id: card.id, revision: 2 }], deletedCardIds: [] },
    { sequence: 2, cards: [], deletedCardIds: [card.id] },
  ]);
  expect(readCanvasEvaluationCommitScopes(CanvasSynchronizationSchema.parse({ kind: 'snapshot', snapshot: { documentId: 'document', schemaVersion: 1, sequence: 2, elements: [] } }))).toEqual([]);
});
