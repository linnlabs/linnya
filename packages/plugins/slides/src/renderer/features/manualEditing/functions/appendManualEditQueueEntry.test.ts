import { describe, expect, it } from 'vitest';
import type { ManualEditQueueEntry } from '../definitions/manualEditQueue';
import type { ManualEditIntent } from '../definitions/manualEditingTypes';
import { appendManualEditQueueEntry } from './appendManualEditQueueEntry';

const headline = { slideKey: 'overview', editKey: 'headline' };
const subtitle = { slideKey: 'overview', editKey: 'subtitle' };
let sequence = 0;
function entry(intent: ManualEditIntent): ManualEditQueueEntry {
  sequence += 1;
  return { intent, clientOperationIds: [`op-${sequence}`] };
}
function append(...entries: ManualEditQueueEntry[]): readonly ManualEditQueueEntry[] {
  return entries.reduce<readonly ManualEditQueueEntry[]>(appendManualEditQueueEntry, []);
}

describe('appendManualEditQueueEntry', () => {
  it('merges rapid clicks on the same style field into one write, keeping every receipt and one undo step', () => {
    const queue = append(
      entry({ operation: { op: 'set_text_style', target: headline, fontSizePt: 24 } }),
      entry({ operation: { op: 'set_text_style', target: headline, fontSizePt: 26 } }),
      entry({ operation: { op: 'set_text_style', target: headline, fontSizePt: 28 } }),
    );
    expect(queue).toHaveLength(1);
    expect(queue[0]?.intent.operation).toEqual({ op: 'set_text_style', target: headline, fontSizePt: 28 });
    expect(queue[0]?.clientOperationIds).toHaveLength(3);
  });

  it('keeps edits of different fields on the same object as separate undo steps', () => {
    expect(append(
      entry({ operation: { op: 'set_text_style', target: headline, fontSizePt: 24 } }),
      entry({ operation: { op: 'set_text_style', target: headline, color: '#2563EB' } }),
    )).toHaveLength(2);
  });

  it('keeps different targets, layer steps and deletions as separate undo steps', () => {
    expect(append(
      entry({ operation: { op: 'set_fill_color', target: headline, targetKind: 'shape', color: '#111111' } }),
      entry({ operation: { op: 'set_fill_color', target: subtitle, targetKind: 'shape', color: '#222222' } }),
    )).toHaveLength(2);
    expect(append(
      entry({ operation: { op: 'set_layer', target: headline, direction: 'forward' } }),
      entry({ operation: { op: 'set_layer', target: headline, direction: 'forward' } }),
    )).toHaveLength(2);
  });

  it('sums queued nudges, including multi-selection batches, on the compiler grid', () => {
    const nudge = (dx: number): ManualEditIntent => ({
      operation: { op: 'batch', operations: [headline, subtitle].map(target => ({ op: 'translate_by' as const, target, targetKind: 'text' as const, delta: { dx, dy: 0 } })) },
      translationPreviews: [{ elementId: 'headline', affectedElementIds: ['headline', 'subtitle'], dx, dy: 0 }],
    });
    const queue = append(entry(nudge(0.0104)), entry(nudge(0.0104)), entry(nudge(0.0104)));
    expect(queue).toHaveLength(1);
    expect(queue[0]?.intent.operation).toMatchObject({ op: 'batch', operations: [
      { target: headline, delta: { dx: 0.0312, dy: 0 } }, { target: subtitle, delta: { dx: 0.0312, dy: 0 } },
    ] });
    expect(queue[0]?.intent.translationPreviews).toHaveLength(3);
  });

  it('coalesces resize dimensions while accumulating anchor motion', () => {
    const queue = append(
      entry({ operation: { op: 'set_visual_size', target: headline, targetKind: 'shape', visualSize: { width: 3, height: 2 }, translationDelta: { dx: -1, dy: -1 } } }),
      entry({ operation: { op: 'set_visual_size', target: headline, targetKind: 'shape', visualSize: { width: 5, height: 4 } } }),
    );
    expect(queue[0]?.intent.operation).toMatchObject({ visualSize: { width: 5, height: 4 }, translationDelta: { dx: -1, dy: -1 } });
  });
});
