import { describe, expect, it } from 'vitest';
import {
  annotateLineNodeSemantics,
  classifyOverlap,
} from '../engine/quality/SpatialSemantics.js';

describe('SpatialSemantics', () => {
  it('classifies a lower-z large image carrying foreground text as background', () => {
    expect(classifyOverlap(
      { kind: 'image', box: { x: 0, y: 0, w: 10, h: 5.625 }, zIndex: 0 },
      { kind: 'text', box: { x: 0.8, y: 0.7, w: 4, h: 0.7 }, zIndex: 2 },
    )).toBe('background');
  });

  it('does not call a higher-z image a background for covered text', () => {
    expect(classifyOverlap(
      { kind: 'image', box: { x: 0, y: 0, w: 10, h: 5.625 }, zIndex: 3 },
      { kind: 'text', box: { x: 0.8, y: 0.7, w: 4, h: 0.7 }, zIndex: 2 },
    )).toBe('forbidden');
  });

  it('classifies a translucent shape above an image as overlay', () => {
    expect(classifyOverlap(
      { kind: 'image', box: { x: 0, y: 0, w: 10, h: 5.625 }, zIndex: 0 },
      { kind: 'shape', box: { x: 0, y: 0, w: 10, h: 5.625 }, zIndex: 1, opacity: 0.42 },
    )).toBe('overlay');
  });

  it('uses semantic roles for an annotation on a primary visual', () => {
    expect(classifyOverlap(
      {
        kind: 'chart',
        box: { x: 1, y: 1, w: 7, h: 3.5 },
        zIndex: 1,
        semanticRole: 'primary-visual',
      },
      {
        kind: 'text',
        box: { x: 5.5, y: 1.4, w: 1.5, h: 0.6 },
        zIndex: 2,
        semanticRole: 'annotation',
      },
    )).toBe('overlay');
  });

  it('classifies direct parent-child overlap as container', () => {
    expect(classifyOverlap(
      {
        nodeId: 'group-1',
        kind: 'group',
        box: { x: 1, y: 1, w: 4, h: 3 },
        zIndex: 0,
      },
      {
        nodeId: 'text-1',
        parentNodeId: 'group-1',
        kind: 'text',
        box: { x: 1.4, y: 1.4, w: 2, h: 0.5 },
        zIndex: 0,
      },
    )).toBe('container');
  });

  it('classifies siblings in an explicit non-slide component as container semantics', () => {
    expect(classifyOverlap(
      {
        nodeId: 'component-bg',
        parentNodeId: 'component-1',
        kind: 'shape',
        box: { x: 1, y: 1, w: 3, h: 2 },
      },
      {
        nodeId: 'component-label',
        parentNodeId: 'component-1',
        kind: 'text',
        box: { x: 1.2, y: 1.2, w: 2.6, h: 0.5 },
      },
    )).toBe('container');

    expect(classifyOverlap(
      {
        nodeId: 'component-text-a',
        parentNodeId: 'component-1',
        kind: 'text',
        box: { x: 1, y: 1, w: 2, h: 1 },
      },
      {
        nodeId: 'component-text-b',
        parentNodeId: 'component-1',
        kind: 'text',
        box: { x: 1.2, y: 1.1, w: 2, h: 1 },
      },
    )).toBe('forbidden');

    expect(classifyOverlap(
      {
        nodeId: 'page-a',
        parentNodeId: 'slide:1',
        kind: 'text',
        box: { x: 1, y: 1, w: 2, h: 1 },
      },
      {
        nodeId: 'page-b',
        parentNodeId: 'slide:1',
        kind: 'text',
        box: { x: 1.2, y: 1.1, w: 2, h: 1 },
      },
    )).toBe('forbidden');
  });

  it('classifies a small shape attached to a thin line as a decorative line node', () => {
    const nodes = annotateLineNodeSemantics([
      { nodeId: 'line', kind: 'shape', box: { x: 2, y: 1, w: 0.02, h: 2 } },
      { nodeId: 'node', kind: 'shape', box: { x: 1.91, y: 1.8, w: 0.2, h: 0.2 } },
      { nodeId: 'label', kind: 'text', box: { x: 1.95, y: 1.82, w: 1, h: 0.18 } },
    ]);

    expect(nodes[1].isLineNode).toBe(true);
    expect(classifyOverlap(nodes[1], nodes[2])).toBe('decorative');
  });

  it('classifies a lower-z shape carrying a materialized chart as a container', () => {
    expect(classifyOverlap(
      {
        kind: 'shape',
        box: { x: 0.58, y: 1.33, w: 5.55, h: 3.62 },
        zIndex: 4,
      },
      {
        kind: 'chart',
        box: { x: 0.78, y: 1.78, w: 5.15, h: 2.97 },
        zIndex: 6,
      },
    )).toBe('container');

    expect(classifyOverlap(
      {
        kind: 'chart',
        box: { x: 0.78, y: 1.78, w: 5.15, h: 2.97 },
        zIndex: 4,
      },
      {
        kind: 'shape',
        box: { x: 0.58, y: 1.33, w: 5.55, h: 3.62 },
        zIndex: 6,
      },
    )).toBe('forbidden');
  });

  it('retains shape-text container and thin decoration semantics', () => {
    expect(classifyOverlap(
      { kind: 'shape', box: { x: 1, y: 1, w: 3, h: 2 } },
      { kind: 'text', box: { x: 1.2, y: 1.2, w: 2.6, h: 0.5 } },
    )).toBe('container');

    expect(classifyOverlap(
      { kind: 'shape', box: { x: 1, y: 1.2, w: 3, h: 0.05 } },
      { kind: 'text', box: { x: 1, y: 1, w: 3, h: 0.5 } },
    )).toBe('decorative');
  });
});
