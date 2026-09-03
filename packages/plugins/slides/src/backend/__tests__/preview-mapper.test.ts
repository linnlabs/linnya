import { describe, expect, it } from 'vitest';import { PreviewMapper } from '../engine/parser/PreviewMapper.js';
import type { CanonicalDeck } from '@plugin/slides/shared';

const mapper = new PreviewMapper();

function makeCanonical(overrides?: Partial<CanonicalDeck>): CanonicalDeck {
  return {
    nodeId: 'node-1',
    versionNumber: 1,
    title: 'Test',
    slideSize: { width: 10, height: 5.625 },
    slides: [
      {
        slideId: 's1',
        number: 1,
        elements: [
          {
            elementId: 'cid-aaa',
            role: 'title',
            text: 'Hello',
            position: { x: 1, y: 1, w: 8, h: 1 },
            zOrder: 0,
            patchMeta: { creationId: 'aaa', elementName: 'Title 1' },
          },
          {
            elementId: 's1-p2_3_2_2',
            role: 'shape',
            position: { x: 2, y: 3, w: 2, h: 2 },
            zOrder: 1,
            patchMeta: { elementName: 'Shape 0' },
          },
        ],
      },
    ],
    theme: { colors: { accent1: '#FF0000' }, fonts: { major: 'Arial', minor: 'Calibri' } },
    masterCount: 1,
    ...overrides,
  };
}

describe('PreviewMapper', () => {
  it('maps CanonicalDeck to DeckPreview', () => {
    const preview = mapper.toPreview(makeCanonical());

    expect(preview.nodeId).toBe('node-1');
    expect(preview.versionNumber).toBe(1);
    expect(preview.title).toBe('Test');
    expect(preview.slides).toHaveLength(1);
    expect(preview.slides[0].slideId).toBe('s1');
    expect(preview.slides[0].elements).toHaveLength(2);
    expect(preview.warnings).toHaveLength(0);
  });

  it('maps title role to text type', () => {
    const preview = mapper.toPreview(makeCanonical());
    expect(preview.slides[0].elements[0].type).toBe('text');
    expect(preview.slides[0].elements[0].text).toBe('Hello');
  });

  it('maps shape role to shape type', () => {
    const preview = mapper.toPreview(makeCanonical());
    expect(preview.slides[0].elements[1].type).toBe('shape');
  });

  it('preserves elementId', () => {
    const preview = mapper.toPreview(makeCanonical());
    expect(preview.slides[0].elements[0].elementId).toBe('cid-aaa');
  });

  it('preserves theme', () => {
    const preview = mapper.toPreview(makeCanonical({
      theme: {
        colors: { accent1: '#FF0000' },
        fonts: { major: 'Arial', minor: 'Calibri' },
        chart: { palette: ['#B64646', '#4776B1'] },
      },
    }));
    expect(preview.theme.colors.accent1).toBe('#FF0000');
    expect(preview.theme.fonts.major).toBe('Arial');
    expect(preview.theme.chart?.palette).toEqual(['#B64646', '#4776B1']);
  });

  it('generates warning for unsupported elements', () => {
    const canonical = makeCanonical({
      slides: [{
        slideId: 's1',
        number: 1,
        elements: [{
          elementId: 'other-1',
          role: 'other',
          zOrder: 0,
          patchMeta: { elementName: 'Unknown Thing' },
        }],
      }],
    });

    const preview = mapper.toPreview(canonical);
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0].code).toBe('unsupported_element');
    expect(preview.warnings[0].slideNumber).toBe(1);
    expect(preview.warnings[0].elementId).toBe('other-1');
  });

  it('normalizes embedded image refs', () => {
    const canonical = makeCanonical({
      slides: [{
        slideId: 's1',
        number: 1,
        elements: [{
          elementId: 'img-1',
          role: 'image',
          imageRef: '../media/image1.png',
          position: { x: 1, y: 1, w: 4, h: 3 },
          zOrder: 0,
          patchMeta: { elementName: 'Picture 1' },
        }],
      }],
    });

    const preview = mapper.toPreview(canonical);
    expect(preview.slides[0].elements[0].imageRef).toEqual({
      type: 'embedded',
      partPath: '../media/image1.png',
    });
  });

  it('generates warning for unresolvable image ref', () => {
    const canonical = makeCanonical({
      slides: [{
        slideId: 's1',
        number: 1,
        elements: [{
          elementId: 'img-bad',
          role: 'image',
          imageRef: 'image1.png',
          position: { x: 1, y: 1, w: 4, h: 3 },
          zOrder: 0,
          patchMeta: { elementName: 'Picture 1' },
        }],
      }],
    });

    const preview = mapper.toPreview(canonical);
    expect(preview.warnings.some((w) => w.code === 'missing_asset')).toBe(true);
  });

  it('reports when an unsupported SVG is retained through its raster fallback', () => {
    const canonical = makeCanonical({
      slides: [{
        slideId: 's1',
        number: 1,
        elements: [{
          elementId: 'svg-fallback-1',
          role: 'image',
          imageRef: '../media/image1.png',
          importFidelity: { status: 'raster-fallback', reason: 'unsupported_svg' },
          position: { x: 1, y: 1, w: 4, h: 3 },
          zOrder: 0,
          patchMeta: { elementName: 'External SVG' },
        }],
      }],
    });

    expect(mapper.toPreview(canonical).warnings).toContainEqual({
      slideNumber: 1,
      elementId: 'svg-fallback-1',
      code: 'fidelity_fallback',
      message: 'The SVG picture uses its raster fallback because the vector content is unsupported.',
    });
  });

  it('handles empty slides', () => {
    const canonical = makeCanonical({ slides: [] });
    const preview = mapper.toPreview(canonical);
    expect(preview.slides).toHaveLength(0);
    expect(preview.warnings).toHaveLength(0);
  });

  it('builds a parse_error preview fallback', () => {
    const preview = mapper.toParseErrorPreview({
      nodeId: 'node-1',
      versionNumber: 3,
      title: 'Broken Deck',
      slideSize: { width: 10, height: 5.625 },
      theme: {
        colors: { accent1: '#123456' },
        fonts: { major: 'Aptos', minor: 'Aptos' },
        chart: { palette: ['#B64646', '#4776B1'] },
      },
      message: 'pptx parse failed',
    });

    expect(preview.slides).toEqual([]);
    expect(preview.warnings).toEqual([
      {
        slideNumber: 0,
        code: 'parse_error',
        message: 'pptx parse failed',
      },
    ]);
    expect(preview.theme.colors.accent1).toBe('#123456');
    expect(preview.theme.chart?.palette).toEqual(['#B64646', '#4776B1']);
  });
});
