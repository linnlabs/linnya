import { describe, expect, it } from 'vitest';
import { normalizeDeckSpecLineSpacingInput } from './normalizeDeckSpecLineSpacing';

describe('normalizeDeckSpecLineSpacingInput', () => {
  it('migrates historical numeric spacing only at the DeckSpec admission boundary', () => {
    const stored = {
      title: 'Legacy deck',
      slides: [{
        slideNumber: 1,
        spec: {
          type: 'structured',
          elements: [
            { type: 'text', style: { lineSpacing: 1.18 } },
            { type: 'text', style: { lineSpacing: 18 } },
          ],
        },
      }],
    };

    expect(normalizeDeckSpecLineSpacingInput(stored)).toMatchObject({
      slides: [{
        spec: {
          elements: [
            { style: { lineSpacing: { kind: 'multiple', value: 1.18 } } },
            { style: { lineSpacing: { kind: 'exactPt', value: 18 } } },
          ],
        },
      }],
    });
    expect(stored.slides[0]?.spec.elements[0]?.style.lineSpacing).toBe(1.18);
  });

  it('preserves the current discriminated contract', () => {
    const current = { lineSpacing: { kind: 'exactPt', value: 12 } };
    expect(normalizeDeckSpecLineSpacingInput(current)).toEqual(current);
  });

  it('rejects invalid stored line spacing instead of silently defaulting', () => {
    expect(() => normalizeDeckSpecLineSpacingInput({ lineSpacing: '1.2' }))
      .toThrow('invalid text lineSpacing');
  });
});
