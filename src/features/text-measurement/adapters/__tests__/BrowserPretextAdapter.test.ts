import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserPretextAdapter } from '../BrowserPretextAdapter.js';

const PX_PER_INCH = 96;

describe('BrowserPretextAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('measures cluster advances by prefix differences', () => {
    const context = {
      font: '',
      measureText(text: string) {
        return { width: text.length * 12 };
      },
    };
    class FakeOffscreenCanvas {
      constructor(
        _width: number,
        _height: number,
      ) {}

      getContext(_kind: '2d') {
        return context;
      }
    }
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);

    const adapter = new BrowserPretextAdapter();
    const result = adapter.measureClusterAdvancesWithSource({
      clusters: ['a', 'b', 'c'],
      style: {
        bold: false,
        fontFamily: 'Arial',
        fontSizePt: 12,
        italic: false,
        lineHeightMultiplier: 1.2,
      },
      sourceKind: 'generated',
    });

    expect(result.source).toBe('pretext');
    expect(result.advances).toHaveLength(3);
    expect(result.advances.reduce((sum, advance) => sum + advance, 0))
      .toBeCloseTo((3 * 12) / PX_PER_INCH, 6);
  });
});
