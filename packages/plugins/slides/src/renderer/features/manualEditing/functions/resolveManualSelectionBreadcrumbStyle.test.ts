import { describe, expect, it } from 'vitest';
import type { ManualEditableTarget } from '../definitions/manualEditingTypes';
import { resolveManualSelectionBreadcrumbStyle } from './resolveManualSelectionBreadcrumbStyle';

describe('resolveManualSelectionBreadcrumbStyle', () => {
  it('anchors the hierarchy label to the selected bounds top-edge center', () => {
    const target: ManualEditableTarget = {
      elementId: 'authoring-overview-title',
      nodeKind: 'text',
      targetKind: 'text',
      capabilities: ['translate'],
      authoringRef: { slideKey: 'overview', editKey: 'title' },
      authoringAncestorRefs: [],
      bounds: { x: 1, y: 2, w: 4, h: 3 },
      polygon: [
        { x: 1, y: 2 },
        { x: 5, y: 2 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
      ],
      translationElementIds: ['authoring-overview-title'],
    };

    expect(resolveManualSelectionBreadcrumbStyle(target, {
      slideLeft: 24,
      slideTop: 36,
      renderScale: 0.5,
    })).toEqual({
      left: '168px',
      top: '132px',
    });
  });
});
