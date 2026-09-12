import { describe, expect, it } from 'vitest';
import type { RenderNode, TextRenderNode } from '../../../types/render';
import {
  collectManualEditableTargets,
  findManualEditableTargetAtPoint,
} from './manualEditableTargets';

function textNode(overrides: Partial<TextRenderNode> = {}): TextRenderNode {
  return {
    id: 'authoring-overview-headline',
    kind: 'text',
    box: { x: 1, y: 1, w: 4, h: 1, unit: 'in' },
    zIndex: 1,
    paragraphs: [{ runs: [{ text: 'Quarterly growth' }] }],
    sourceSpan: { startLine: 3, endLine: 3 },
    authoringRef: { slideKey: 'overview', editKey: 'headline', targetKind: 'text' },
    ...overrides,
  };
}

describe('manual editable targets', () => {
  it('collects stable authoring targets and exposes plain text content', () => {
    expect(collectManualEditableTargets([textNode()])).toEqual([expect.objectContaining({
      elementId: 'authoring-overview-headline',
      targetKind: 'text',
      authoringRef: { slideKey: 'overview', editKey: 'headline' },
      textContent: 'Quarterly growth',
    })]);
  });

  it('keeps rich, formula and locked text out of direct text editing', () => {
    const nodes: RenderNode[] = [
      textNode({ paragraphs: [{ runs: [{ text: 'Rich' }, { text: ' title', fontWeight: 'bold' }] }] }),
      textNode({ id: 'formula-text', paragraphs: [{ runs: [{
        kind: 'formula',
        projection: {
          source: 'x', display: 'inline', align: 'left',
          svg: '<svg/>', viewBox: { minX: 0, minY: 0, width: 1, height: 1 },
          contentHash: 'hash', altText: 'x', baselineRatio: 0.8,
        },
      }] }] }),
      textNode({ id: 'locked', locked: true }),
    ];

    const targets = collectManualEditableTargets(nodes);
    expect(targets).toHaveLength(2);
    expect(targets.every(target => target.textContent === undefined)).toBe(true);
  });

  it('hit-tests the topmost editable authoring polygon', () => {
    const bottom = textNode();
    const top = textNode({
      id: 'authoring-overview-top',
      zIndex: 2,
      authoringRef: { slideKey: 'overview', editKey: 'top', targetKind: 'text' },
    });
    expect(findManualEditableTargetAtPoint([bottom, top], { x: 2, y: 1.5 })?.elementId)
      .toBe('authoring-overview-top');
    expect(findManualEditableTargetAtPoint([bottom, top], { x: 1, y: 1 })?.elementId)
      .toBe('authoring-overview-top');
  });
});
