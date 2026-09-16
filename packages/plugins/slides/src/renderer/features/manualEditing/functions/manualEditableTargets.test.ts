import { describe, expect, it } from 'vitest';
import type { RenderNode, TextRenderNode } from '../../../types/render';
import {
  collectManualEditableTargets,
  findManualEditableTargetAtPoint,
  findManualEditableTargetPathAtPoint,
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
      capabilities: ['translate', 'set_text_content', 'set_text_style'],
      text: { kind: 'plain_text', content: 'Quarterly growth' },
    },
    ...overrides,
  };
}

describe('manual editable targets', () => {
  it('collects stable authoring targets and exposes an in-place text projection', () => {
    expect(collectManualEditableTargets([textNode()])).toEqual([expect.objectContaining({
      elementId: 'authoring-overview-headline',
      targetKind: 'text',
      authoringRef: { slideKey: 'overview', editKey: 'headline' },
      textEditing: expect.objectContaining({
        content: 'Quarterly growth',
        origin: { x: 1, y: 1 },
        width: 4,
        height: 1,
      }),
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
          capabilities: ['translate', 'set_text_content', 'set_text_style'],
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
    expect(targets[0]?.textEditing?.content).toBe('增长 2026\n下一行');
    expect(targets.slice(1).every(target => target.textEditing === undefined)).toBe(true);
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

  it('projects one Frame scope whose selection bounds include an outlying child', () => {
    const frameRef = { slideKey: 'overview', editKey: 'card1', targetKind: 'frame' } as const;
    const nodes: RenderNode[] = [
      {
        id: 'authoring-overview-card1',
        kind: 'shape',
        box: { x: 1, y: 1, w: 4, h: 2, unit: 'in' },
        zIndex: 1,
        geometry: { type: 'preset', name: 'roundRect' },
        authoringRef: frameRef,
        authoringEdit: { capabilities: ['translate'] },
      },
      {
        ...textNode({
          id: 'authoring-overview-card1Label',
          box: { x: 1.4, y: 1.4, w: 2, h: 0.5, unit: 'in' },
          zIndex: 2,
          authoringRef: {
            slideKey: 'overview', editKey: 'card1Label', targetKind: 'text',
          },
        }),
        authoringAncestorRefs: [frameRef],
      },
      {
        id: 'authoring-overview-card1Badge',
        kind: 'shape',
        box: { x: 6.25, y: 1.3, w: 0.5, h: 0.5, unit: 'in' },
        zIndex: 3,
        geometry: { type: 'preset', name: 'ellipse' },
        authoringRef: {
          slideKey: 'overview', editKey: 'card1Badge', targetKind: 'shape',
        },
        authoringAncestorRefs: [frameRef],
        authoringEdit: { capabilities: ['translate'] },
      },
    ];

    const frame = collectManualEditableTargets(nodes)
      .find(target => target.elementId === 'authoring-overview-card1');
    expect(frame).toMatchObject({
      targetKind: 'frame',
      bounds: { x: 1, y: 1, w: 5.75, h: 2 },
      polygon: [
        { x: 1, y: 1 },
        { x: 6.75, y: 1 },
        { x: 6.75, y: 3 },
        { x: 1, y: 3 },
      ],
      translationElementIds: [
        'authoring-overview-card1',
        'authoring-overview-card1Label',
        'authoring-overview-card1Badge',
      ],
      frameSelectionFragments: [
        expect.objectContaining({ elementId: 'authoring-overview-card1' }),
        expect.objectContaining({ elementId: 'authoring-overview-card1Label' }),
        expect.objectContaining({ elementId: 'authoring-overview-card1Badge' }),
      ],
    });
  });

  it('returns the visible Frame before the child under the same point', () => {
    const frameRef = { slideKey: 'overview', editKey: 'card1', targetKind: 'frame' } as const;
    const frame: RenderNode = {
      id: 'authoring-overview-card1',
      kind: 'shape',
      box: { x: 1, y: 1, w: 4, h: 2, unit: 'in' },
      zIndex: 1,
      geometry: { type: 'preset', name: 'roundRect' },
      authoringRef: frameRef,
      authoringEdit: { capabilities: ['translate'] },
    };
    const child = textNode({
      id: 'authoring-overview-card1Label',
      box: { x: 1.4, y: 1.4, w: 2, h: 0.5, unit: 'in' },
      zIndex: 2,
      authoringRef: { slideKey: 'overview', editKey: 'card1Label', targetKind: 'text' },
      authoringAncestorRefs: [frameRef],
    });

    expect(findManualEditableTargetPathAtPoint([frame, child], { x: 1.5, y: 1.5 })
      .map(target => target.elementId)).toEqual([
      'authoring-overview-card1',
      'authoring-overview-card1Label',
    ]);
    expect(findManualEditableTargetPathAtPoint([frame, child], { x: 3.8, y: 2.5 })
      .map(target => target.elementId)).toEqual(['authoring-overview-card1']);
  });

  it('does not turn the empty gap inside expanded Frame bounds into a hit area', () => {
    const frameRef = { slideKey: 'overview', editKey: 'card1', targetKind: 'frame' } as const;
    const frame: RenderNode = {
      id: 'authoring-overview-card1',
      kind: 'shape',
      box: { x: 1, y: 1, w: 2, h: 2, unit: 'in' },
      zIndex: 1,
      geometry: { type: 'preset', name: 'roundRect' },
      authoringRef: frameRef,
      authoringEdit: { capabilities: ['translate'] },
    };
    const child = textNode({
      id: 'authoring-overview-card1Label',
      box: { x: 5, y: 1.4, w: 1, h: 0.5, unit: 'in' },
      zIndex: 2,
      authoringRef: { slideKey: 'overview', editKey: 'card1Label', targetKind: 'text' },
      authoringAncestorRefs: [frameRef],
    });
    const projection = {
      transientTranslation: null,
      pendingTranslation: null,
      pendingVisual: null,
      queuedIntents: [],
    };

    expect(findManualEditableTargetPathAtPoint([frame, child], { x: 4, y: 1.5 }, projection))
      .toEqual([]);
    expect(findManualEditableTargetPathAtPoint([frame, child], { x: 5.5, y: 1.5 }, projection)
      .map(target => target.elementId)).toEqual([
      'authoring-overview-card1',
      'authoring-overview-card1Label',
    ]);
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

  it('hit-tests the visible queued translation instead of the committed position', () => {
    const node = textNode();
    const projection = {
      transientTranslation: null,
      pendingTranslation: {
        elementId: node.id,
        affectedElementIds: [node.id],
        dx: 4,
        dy: 1,
      },
      pendingVisual: null,
      queuedIntents: [],
    };

    expect(findManualEditableTargetPathAtPoint([node], { x: 5.5, y: 2.5 }, projection))
      .toHaveLength(1);
    expect(findManualEditableTargetPathAtPoint([node], { x: 1.5, y: 1.5 }, projection))
      .toEqual([]);
  });

  it('excludes a Frame and its descendants after a queued delete preview', () => {
    const frameRef = { slideKey: 'overview', editKey: 'card1', targetKind: 'frame' } as const;
    const frame: RenderNode = {
      id: 'authoring-overview-card1',
      kind: 'shape',
      box: { x: 1, y: 1, w: 4, h: 2, unit: 'in' },
      zIndex: 1,
      geometry: { type: 'preset', name: 'roundRect' },
      authoringRef: frameRef,
      authoringEdit: { capabilities: ['translate', 'delete'] },
    };
    const child = textNode({
      id: 'authoring-overview-card1Label',
      authoringRef: { slideKey: 'overview', editKey: 'card1Label', targetKind: 'text' },
      authoringAncestorRefs: [frameRef],
    });
    const operation = {
      op: 'delete_target' as const,
      target: { slideKey: 'overview', editKey: 'card1' },
      targetKind: 'frame' as const,
    };
    const projection = {
      transientTranslation: null,
      pendingTranslation: null,
      pendingVisual: {
        elementId: frame.id,
        affectedElementIds: [frame.id, child.id],
        operation,
      },
      queuedIntents: [],
    };

    expect(findManualEditableTargetPathAtPoint([frame, child], { x: 1.5, y: 1.5 }, projection))
      .toEqual([]);
  });
});
