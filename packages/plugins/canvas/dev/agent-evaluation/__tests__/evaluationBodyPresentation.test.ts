import { expect, it } from 'vitest';
import { CanvasCardIdSchema } from '@plugin/canvas/shared';
import type { CanvasRasterReadiness } from '../../../src/renderer/orchestration/createCanvasRasterPresentation';
import { readCanvasEvaluationBodyPresentation } from '../readCanvasEvaluationBodyPresentation';

it('两个可见目标必须都展示目标修订；首张、远景、离屏和更晚修订不能冒充整批', () => {
  const first = CanvasCardIdSchema.parse('c1'), second = CanvasCardIdSchema.parse('c2'), outside = CanvasCardIdSchema.parse('c3'), overview = CanvasCardIdSchema.parse('c4');
  const revisions = new Map([[first, 2], [second, 2], [outside, 2], [overview, 2]]);
  const state: CanvasRasterReadiness = { complete: false, precisionSettling: false, suspended: false, cards: [
    { id: first, revision: 2, mode: 'body', status: 'awaiting_draw', firstPresented: true },
    { id: second, revision: 2, mode: 'body', status: 'pending', firstPresented: false },
    { id: outside, revision: 2, mode: 'outside', status: 'not_required' }, { id: overview, revision: 2, mode: 'overview', status: 'not_required' },
  ] };
  const initial = readCanvasEvaluationBodyPresentation(state, revisions);
  expect(initial.visibleBodyIds).toEqual([first, second]); expect(initial.presentedBodyIds).toEqual([first]); expect(initial.allVisiblePresented).toBe(false);
  const both: CanvasRasterReadiness = { ...state, cards: state.cards.map(card => card.mode === 'body' ? { ...card, firstPresented: true } : card) };
  expect(readCanvasEvaluationBodyPresentation(both, revisions).allVisiblePresented).toBe(true); expect(both.complete).toBe(false);
  const newer: CanvasRasterReadiness = { ...both, complete: true, cards: both.cards.map(card => card.id === second ? { ...card, revision: 3 } : card) };
  const superseded = readCanvasEvaluationBodyPresentation(newer, revisions);
  expect(superseded.allVisiblePresented).toBe(false); expect(superseded.supersededCardIds).toEqual([second]);
  const deleted: CanvasRasterReadiness = { ...both, cards: both.cards.map((card): CanvasRasterReadiness['cards'][number] => card.id === second ? { id: second, mode: 'outside', revision: null, status: 'not_required' } : card) };
  expect(readCanvasEvaluationBodyPresentation(deleted, revisions).supersededCardIds).toEqual([second]);
  expect(readCanvasEvaluationBodyPresentation({ ...both, suspended: true }, revisions).allVisiblePresented).toBe(false);
});
