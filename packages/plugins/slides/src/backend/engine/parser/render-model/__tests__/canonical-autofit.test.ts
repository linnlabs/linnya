import { describe, expect, it } from 'vitest';
import type { CanonicalElement, CanonicalSlide, ThemeInfo } from '@plugin/slides/shared';
import { CanonicalBuilder } from '../../CanonicalBuilder.js';
import { mapCanonicalSlide } from '../CanonicalRenderModelMapper.js';
import { resolveRenderDefaults } from '../RenderModelShared.js';

const THEME: ThemeInfo = {
  colors: {},
  fonts: { major: 'Aptos Display', minor: 'Aptos' },
  chart: { palette: ['#2563EB'] },
};

function makeCanonicalElement(overrides: Partial<CanonicalElement>): CanonicalElement {
  return {
    elementId: 'element-1',
    role: 'body',
    text: 'Imported text that should retain its bodyPr autofit policy.',
    position: { x: 1, y: 1, w: 3, h: 1 },
    zOrder: 0,
    patchMeta: {},
    ...overrides,
  };
}

function makeSlide(element: CanonicalElement): CanonicalSlide {
  return {
    slideId: 'slide-1',
    number: 1,
    elements: [element],
  };
}

describe('CanonicalRenderModelMapper imported autofit', () => {
  it('maps imported text bodyPr autofit into TextRenderNode.autoFitPolicy', () => {
    const model = mapCanonicalSlide(
      makeSlide(makeCanonicalElement({
        visual: { textAutoFit: 'shrink-text' },
      })),
      0,
      undefined,
      resolveRenderDefaults(THEME),
    );

    const node = model.elements[0];
    expect(node?.kind).toBe('text');
    if (node?.kind === 'text') {
      expect(node.autoFitPolicy).toBe('shrink-text');
    }
  });

  it('preserves bodyPr autofit while building canonical visual hints', () => {
    const canonical = new CanonicalBuilder().build(
      'deck-1',
      1,
      'Imported deck',
      {
        slideCount: 1,
      slideSize: { width: 10, height: 5.625 },
      theme: THEME,
        masters: [{ name: 'Master', layouts: ['Blank'] }],
      slides: [{
        number: 1,
        layoutName: 'Blank',
        elements: [{
          name: 'TextBox 1',
          type: 'text',
          text: 'Imported text',
          position: { x: 1, y: 1, w: 3, h: 1 },
          textBody: { autoFit: 'resize-shape' },
        }],
      }],
      },
    );

    expect(canonical.slides[0]?.elements[0]?.visual?.textAutoFit).toBe('resize-shape');
  });

  it('preserves imported bodyPr padding and wrap through canonical render mapping', () => {
    const padding = { top: 0.2, right: 0.3, bottom: 0.4, left: 0.5 };
    const canonical = new CanonicalBuilder().build(
      'deck-1',
      1,
      'Imported deck',
      {
        slideCount: 1,
        slideSize: { width: 10, height: 5.625 },
        theme: THEME,
        masters: [{ name: 'Master', layouts: ['Blank'] }],
        slides: [{
          number: 1,
          layoutName: 'Blank',
          elements: [{
            name: 'TextBox 1',
            type: 'text',
            text: 'Imported text\nSecond paragraph',
            position: { x: 1, y: 1, w: 3, h: 1 },
            textBody: {
              autoFit: 'shrink-text',
              padding,
              wrap: 'none',
            },
          }],
        }],
      },
    );

    const visual = canonical.slides[0]?.elements[0]?.visual;
    expect(visual?.textPadding).toEqual(padding);
    expect(visual?.textWrap).toBe('none');

    const model = mapCanonicalSlide(
      canonical.slides[0]!,
      0,
      undefined,
      resolveRenderDefaults(THEME),
    );

    const node = model.elements[0];
    expect(node?.kind).toBe('text');
    if (node?.kind === 'text') {
      expect(node.padding).toEqual(padding);
      expect(node.wrap).toBe('none');
      expect(node.autoFitPolicy).toBe('shrink-text');
    }
  });

  it('preserves imported line spacing policy through canonical render mapping', () => {
    const canonical = new CanonicalBuilder().build(
      'deck-1',
      1,
      'Imported deck',
      {
        slideCount: 1,
        slideSize: { width: 10, height: 5.625 },
        theme: THEME,
        masters: [{ name: 'Master', layouts: ['Blank'] }],
        slides: [{
          number: 1,
          layoutName: 'Blank',
          elements: [{
            name: 'TextBox 1',
            type: 'text',
            text: 'Imported text',
            position: { x: 1, y: 1, w: 3, h: 1 },
            paragraphs: [{
              runs: [{ text: 'Imported text' }],
              lineSpacing: { kind: 'exactPt', value: 18 },
            }, {
              runs: [{ text: 'Second ' }, { text: 'paragraph', bold: true }],
              lineSpacing: { kind: 'multiple', value: 1.3 },
              spacingBeforePt: 6,
            }],
          }],
        }],
      },
    );

    expect(canonical.slides[0]?.elements[0]?.paragraphs?.[0]?.lineSpacing)
      .toEqual({ kind: 'exactPt', value: 18 });

    const model = mapCanonicalSlide(
      canonical.slides[0]!,
      0,
      undefined,
      resolveRenderDefaults(THEME),
    );

    const node = model.elements[0];
    expect(node?.kind).toBe('text');
    if (node?.kind === 'text') {
      expect(node.paragraphs[0]?.lineSpacing).toEqual({ kind: 'exactPt', value: 18 });
      expect(node.paragraphs[1]).toMatchObject({
        runs: [{ text: 'Second ' }, { text: 'paragraph', fontWeight: 'bold' }],
        lineSpacing: { kind: 'multiple', value: 1.3 },
        spacingBefore: 6,
      });
    }
  });
});
