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
    authoringEdit: {
      capabilities: ['translate', 'set_text_content'],
      text: { kind: 'plain_text', content: 'Quarterly growth' },
    },
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

  it('uses authoring text facts instead of render runs to decide direct editing', () => {
    const nodes: RenderNode[] = [
      textNode({
        paragraphs: [
          { runs: [{ text: '增长' }, { text: ' 2026' }] },
          { runs: [{ text: '下一行' }] },
        ],
        authoringEdit: {
          capabilities: ['translate', 'set_text_content'],
          text: { kind: 'plain_text', content: '增长 2026\n下一行' },
        },
      }),
      textNode({
        id: 'rich-text',
        paragraphs: [{ runs: [{ text: 'Rich', fontWeight: 'bold' }] }],
        authoringEdit: { capabilities: ['translate'], text: { kind: 'rich_text' } },
      }),
      textNode({
        id: 'formula-text',
        paragraphs: [{ runs: [{
          kind: 'formula',
          projection: {
            source: 'x', display: 'inline', align: 'left',
            svg: '<svg/>', viewBox: { minX: 0, minY: 0, width: 1, height: 1 },
            contentHash: 'hash', altText: 'x', baselineRatio: 0.8,
          },
        }] }],
        authoringEdit: { capabilities: ['translate'], text: { kind: 'rich_text' } },
      }),
      textNode({ id: 'locked', locked: true }),
    ];

    const targets = collectManualEditableTargets(nodes);
    expect(targets).toHaveLength(3);
    expect(targets[0]?.textContent).toBe('增长 2026\n下一行');
    expect(targets.slice(1).every(target => target.textContent === undefined)).toBe(true);
  });

  it('selects an author shape without coupling manual editing to sourceSpan', () => {
    const shape: RenderNode = {
      id: 'authoring-overview-accent',
      kind: 'shape',
      box: { x: 1, y: 1, w: 2, h: 1, unit: 'in' },
      zIndex: 2,
      geometry: { type: 'preset', name: 'roundRect' },
      authoringRef: { slideKey: 'overview', editKey: 'accent', targetKind: 'shape' },
      authoringEdit: { capabilities: ['translate'] },
    };
    expect(findManualEditableTargetAtPoint([shape], { x: 1.5, y: 1.5 }))
      .toMatchObject({ elementId: shape.id, targetKind: 'shape' });
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
