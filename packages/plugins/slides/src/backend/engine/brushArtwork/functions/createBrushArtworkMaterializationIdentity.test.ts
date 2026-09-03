import { describe, expect, it } from 'vitest';
import type { BrushArtworkIntent } from '@plugin/slides/shared/brushArtwork';
import { createBrushArtworkMaterializationIdentity } from './createBrushArtworkMaterializationIdentity';

describe('Brush artwork materialization identity', () => {
  const intent: BrushArtworkIntent = {
    seed: 9,
    backgroundColor: '#FFFDF8',
    quality: 'standard',
    layers: [{
      stroke: { brush: 'HB', color: '#223344', weight: 1 },
      marks: [{ type: 'line', from: [8, 52], to: [92, 55] }],
    }],
  };

  it('同一意图和尺寸稳定，不同像素尺寸不会共享 binding', () => {
    const first = createBrushArtworkMaterializationIdentity({ intent, widthPx: 800, heightPx: 200 });
    const again = createBrushArtworkMaterializationIdentity({ intent, widthPx: 800, heightPx: 200 });
    const resized = createBrushArtworkMaterializationIdentity({ intent, widthPx: 1600, heightPx: 400 });
    expect(first).toBe(again);
    expect(first).toMatch(/^brush:[0-9a-f]{64}$/u);
    expect(resized).not.toBe(first);
  });

  it('任一绘制语义变化都会产生新的 identity', () => {
    const first = createBrushArtworkMaterializationIdentity({ intent, widthPx: 800, heightPx: 200 });
    const changed = createBrushArtworkMaterializationIdentity({
      intent: {
        ...intent,
        layers: [{
          stroke: { brush: 'HB', color: '#223344', weight: 1 },
          marks: [{ type: 'line', from: [8, 52], to: [90, 55] }],
        }],
      },
      widthPx: 800,
      heightPx: 200,
    });
    expect(changed).not.toBe(first);
  });
});
