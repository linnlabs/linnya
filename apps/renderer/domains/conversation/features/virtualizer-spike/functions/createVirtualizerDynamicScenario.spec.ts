import { describe, expect, it } from 'vitest';
import {
  createVirtualizerDynamicScenario,
  mutateVirtualizerDynamicScenario,
  prependVirtualizerDynamicRows,
} from './createVirtualizerDynamicScenario';

describe('createVirtualizerDynamicScenario', () => {
  it('keeps the same logical anchor while changing only visual-row granularity', () => {
    const visual = createVirtualizerDynamicScenario({
      granularity: 'visual-row',
      runId: 'visual',
      scenario: 'chart-growth',
    });
    const turn = createVirtualizerDynamicScenario({
      granularity: 'turn',
      runId: 'turn',
      scenario: 'chart-growth',
    });

    expect(visual.rows.some(row => row.kind === 'dynamic')).toBe(true);
    expect(visual.rows.some(row => row.kind === 'anchor')).toBe(true);
    expect(turn.rows.filter(row => row.kind === 'turn')).toHaveLength(1);
    expect(turn.rows.some(row => row.kind === 'anchor')).toBe(false);
  });

  it('applies growth, shrink, batch, and prepend mutations without changing existing row keys', () => {
    const fixture = createVirtualizerDynamicScenario({
      granularity: 'visual-row',
      runId: 'mutations',
      scenario: 'batch-resize',
    });
    const mutated = mutateVirtualizerDynamicScenario(fixture.rows, 'batch-resize');
    const prepended = prependVirtualizerDynamicRows(mutated, 'mutations');

    expect(mutated.map(row => row.id)).toEqual(fixture.rows.map(row => row.id));
    expect(mutated.filter(row => row.kind === 'dynamic')).toHaveLength(3);
    expect(prepended.slice(3).map(row => row.id)).toEqual(mutated.map(row => row.id));
  });

  it('keeps nested growth inside a bounded measured row', () => {
    const fixture = createVirtualizerDynamicScenario({
      granularity: 'visual-row',
      runId: 'bounded',
      scenario: 'bounded-nested-growth',
    });
    const before = fixture.rows.find(row => row.id === fixture.measuredRowKey);
    const mutated = mutateVirtualizerDynamicScenario(fixture.rows, 'bounded-nested-growth');
    const after = mutated.find(row => row.id === fixture.measuredRowKey);

    expect(before?.kind).toBe('dynamic');
    expect(before?.kind === 'dynamic' && before.bounded).toBe(true);
    expect(before?.kind === 'dynamic' ? before.block.extent : 0).toBe(40);
    expect(after?.kind === 'dynamic' ? after.block.extent : 0).toBe(120);
  });
});
