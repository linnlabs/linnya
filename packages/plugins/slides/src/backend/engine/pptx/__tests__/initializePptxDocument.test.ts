import { describe, expect, it, vi } from 'vitest';
import PptxGenJS from 'pptxgenjs';

import type { DeckSpec } from '@plugin/slides/shared';
import {
  initializePptxDocument,
  mapDeckLayoutToPptxLayout,
} from '../initializePptxDocument';

function makeDeck(overrides: Partial<DeckSpec> = {}): DeckSpec {
  return {
    title: '年度战略',
    slides: [],
    ...overrides,
  };
}

describe('initializePptxDocument', () => {
  it.each([
    ['16x9', 'LAYOUT_16x9'],
    ['16x10', 'LAYOUT_16x10'],
    ['4x3', 'LAYOUT_4x3'],
  ] as const)('maps deck layout %s to %s', (layout, expected) => {
    expect(mapDeckLayoutToPptxLayout(layout)).toBe(expected);
  });

  it('uses 16x9 when layout is omitted', () => {
    expect(mapDeckLayoutToPptxLayout()).toBe('LAYOUT_16x9');
  });

  it('writes title and declared theme fonts without local font resolution', () => {
    const pptx = new PptxGenJS();
    initializePptxDocument(pptx, makeDeck({
      layout: '16x10',
      theme: { fonts: { major: 'Declared Heading', minor: 'Declared Body' } },
    }));

    expect(pptx.layout).toBe('LAYOUT_16x10');
    expect(pptx.title).toBe('年度战略');
    expect(pptx.theme).toEqual(expect.objectContaining({
      headFontFace: 'Declared Heading',
      bodyFontFace: 'Declared Body',
    }));
  });

  it('defines a deterministic custom layout before selecting it', () => {
    const pptx = new PptxGenJS();
    const defineLayout = vi.spyOn(pptx, 'defineLayout');
    initializePptxDocument(pptx, makeDeck({
      layout: { width: 5.625, height: 10, unit: 'in' },
    }));

    expect(defineLayout).toHaveBeenCalledWith({
      name: 'LINNYA_5143500_9144000',
      width: 5.625,
      height: 10,
    });
    expect(pptx.layout).toBe('LINNYA_5143500_9144000');
  });
});
