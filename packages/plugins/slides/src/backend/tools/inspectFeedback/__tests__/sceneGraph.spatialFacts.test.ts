import { describe, expect, it } from 'vitest';
import type {
  PresentationRenderModel,
  SpatialAnalysisSummary,
  SpatialNode,
} from '@plugin/slides/shared';
import {
  buildReferenceFrames,
  buildSceneGraph,
  buildSpatialAnalysis,
} from '../sceneGraph.js';

describe('scene graph spatial facts', () => {
  it('passes opacity, z-order, parent and semantic role to the spatial analyzer', async () => {
    const model = makeLayeredModel();
    let receivedNodes: SpatialNode[] = [];

    await buildSpatialAnalysis(buildSceneGraph(model), {
      analyzeSpatial: ({ slideNodes }): Promise<SpatialAnalysisSummary> => {
        receivedNodes = slideNodes;
        return Promise.resolve({
          slideNumber: 1,
          sourceKind: 'generated',
          isEmptySlide: false,
          confidence: 1,
          summaryLines: [],
          sections: [],
          relations: [],
          debugLogs: [],
        });
      },
    });

    expect(receivedNodes.find((node) => node.nodeId === 'overlay')).toMatchObject({
      parentNodeId: 'slide:1',
      zIndex: 1,
      opacity: 0.4,
      semanticRole: 'overlay',
    });
  });

  it.each([
    [1, 56],
    [56, 1],
    [1, 1],
  ])('never emits zero or negative reference frames for %s×%s inch slides', (width, height) => {
    const frames = buildReferenceFrames(width, height);

    expect(frames[0]).toMatchObject({ id: 'slide' });
    expect(frames.every((frame) => frame.box.w > 0 && frame.box.h > 0)).toBe(true);
  });

  it('omits a fixed content frame when the document cannot contain it', () => {
    expect(buildReferenceFrames(1, 1).map((frame) => frame.id)).toEqual([
      'slide',
      'safe_area',
    ]);
  });
});

function makeLayeredModel(): PresentationRenderModel {
  return {
    presentationId: 'deck-1',
    title: 'Layered deck',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: [{
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [{
        id: 'overlay',
        kind: 'shape',
        geometry: { type: 'preset', name: 'rect' },
        box: { x: 0, y: 0, w: 10, h: 5.625, unit: 'in' },
        zIndex: 1,
        opacity: 0.4,
        editableTarget: {
          semanticRole: 'overlay',
          operations: ['modify_style'],
        },
      }],
    }],
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
  };
}
