import { expect, it } from 'vitest';
import {
  CanvasCardSchema,
  createCanvasPlainTextDocument,
  type CanvasColor,
  type CanvasCard,
  type CanvasCardId,
} from '../../../../shared';
import { planCanvasSceneMotion } from '../index';

const source = { kind: 'user', conversationId: null, runId: null };
const card = (id: string, x = 0, y = 0, text = '正文', color: CanvasColor = 'white') =>
  CanvasCardSchema.parse({
    id,
    x,
    y,
    width: 280,
    height: 180,
    type: 'text',
    schemaVersion: 1,
    revision: 1,
    order: 'a0',
    locked: false,
    color,
    createdBy: source,
    updatedBy: source,
    createdAt: 0,
    updatedAt: 0,
    parentId: null,
    data: { contentVersion: 1, content: createCanvasPlainTextDocument(text) },
  });

it('plans explicit mixed add/move/remove while excluding body/color-only changes, protection and unknown IDs', () => {
  const beforeCards = [card('c1'), card('c2'), card('c3'), card('c5'), card('c6'), card('c7')];
  const before = new Map(beforeCards.map(value => [value.id, value]));
  const after = [
    card('c1', 20),
    card('c2', 0, 0, '改正文'),
    card('c4'),
    card('c5', 0, 0, '正文', 'red'),
    card('c6', 20),
    card('c7', 20),
  ];
  expect(
    planCanvasSceneMotion({
      before,
      after,
      animateIds: ['c4', 'c1', 'c2', 'c3', 'c5', 'c6', 'c99', 'c1'],
      protectedIds: new Set(['c6']),
    })
  ).toEqual([
    { id: 'c4', kind: 'add', durationMs: 160 },
    { id: 'c1', kind: 'move', durationMs: 220 },
    { id: 'c3', kind: 'remove', durationMs: 120 },
  ]);
  expect(before.get('c1')?.x).toBe(0);
  expect(after.find(value => value.id === 'c1')?.x).toBe(20);
});

it('uses the explicit whole-batch fade for mixed new/existing/removed cards without individual sliding', () => {
  const before = new Map([card('c1'), card('c2'), card('c3')].map(value => [value.id, value]));
  expect(
    planCanvasSceneMotion({
      before,
      after: [card('c1', 10), card('c2', 0, 0, '改正文'), card('c4')],
      animateIds: ['c1', 'c2', 'c3', 'c4'],
      batch: true,
    })
  ).toEqual([
    { id: 'c1', kind: 'batch', durationMs: 200 },
    { id: 'c2', kind: 'batch', durationMs: 200 },
    { id: 'c3', kind: 'remove', durationMs: 200 },
    { id: 'c4', kind: 'batch', durationMs: 200 },
  ]);
});

it('forces a 201-card batch but counts unique known unprotected cards before applying the threshold', () => {
  const after = Array.from({ length: 201 }, (_, i) => card(`c${i + 1}`));
  const ids = after.map(value => value.id),
    before = new Map<CanvasCardId, CanvasCard>();
  const batch = planCanvasSceneMotion({ before, after, animateIds: ids });
  expect(batch).toHaveLength(201);
  expect(batch.every(value => value.kind === 'batch' && value.durationMs === 200)).toBe(true);
  const ordinary = planCanvasSceneMotion({
    before,
    after,
    animateIds: [...ids, ...ids, 'c999'],
    protectedIds: new Set(['c201']),
  });
  expect(ordinary).toHaveLength(200);
  expect(ordinary.every(value => value.kind === 'add' && value.durationMs === 160)).toBe(true);
});
