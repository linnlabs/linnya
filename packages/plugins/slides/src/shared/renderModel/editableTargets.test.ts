import { describe, expect, it } from 'vitest';

import type {
  EditableTarget,
  PresentationRenderModel,
  RenderBox,
  RenderNode,
} from './renderModel';
import {
  collectEditableTargetsBySlide,
  sanitizeToolEditableTarget,
} from './editableTargets';

const BOX: RenderBox = {
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  unit: 'in',
};

function textNode(id: string, editableTarget?: EditableTarget): RenderNode {
  return {
    id,
    kind: 'text',
    box: BOX,
    zIndex: 1,
    paragraphs: [],
    ...(editableTarget ? { editableTarget } : {}),
  };
}

function renderModel(elements: RenderNode[]): PresentationRenderModel {
  return {
    presentationId: 'deck-1',
    title: 'Deck',
    version: 1,
    sourceKind: 'generated',
    slideSize: {
      width: 13.333,
      height: 7.5,
      unit: 'in',
    },
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
    slides: [
      {
        slideId: 'slide-1',
        index: 0,
        layoutKey: 'default',
        background: {
          color: '#FFFFFF',
        },
        elements,
      },
    ],
  };
}

describe('sanitizeToolEditableTarget', () => {
  it('keeps patch operations only when a stable patch locator exists', () => {
    expect(sanitizeToolEditableTarget({
      operations: ['modify_text', 'relayout_slide'],
    })).toBeNull();

    expect(sanitizeToolEditableTarget({
      elementId: 'title',
      operations: ['modify_text', 'relayout_slide'],
    })).toMatchObject({
      elementId: 'title',
      operations: ['modify_text'],
    });
  });

  it('keeps relayout only for semantic targets and clears stale capabilities otherwise', () => {
    expect(sanitizeToolEditableTarget({
      semanticNodeId: 'headline',
      operations: ['relayout_slide'],
      relayoutCapabilities: ['promote'],
    })).toMatchObject({
      semanticNodeId: 'headline',
      operations: ['relayout_slide'],
      relayoutCapabilities: ['promote'],
    });

    expect(sanitizeToolEditableTarget({
      elementId: 'shape-1',
      operations: ['modify_geometry', 'relayout_slide'],
      relayoutCapabilities: ['promote'],
    })).toEqual({
      elementId: 'shape-1',
      operations: ['modify_geometry'],
      relayoutCapabilities: undefined,
    });
  });
});

describe('collectEditableTargetsBySlide', () => {
  it('walks grouped render nodes and stamps the 1-based slide number', () => {
    const targets = collectEditableTargetsBySlide(renderModel([
      {
        id: 'group-1',
        kind: 'group',
        box: BOX,
        zIndex: 1,
        children: [
          textNode('title', {
            elementId: 'title',
            operations: ['modify_text'],
          }),
        ],
      },
    ]));

    expect(targets.get(1)).toEqual([
      {
        slideNumber: 1,
        elementId: 'title',
        operations: ['modify_text'],
        relayoutCapabilities: undefined,
      },
    ]);
  });
});
