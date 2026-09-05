import { describe, expect, it } from 'vitest';
import type { SceneGraphSlideSummary } from '@plugin/slides/shared';
import { buildFocusedInspection } from './focusedInspection';

describe('buildFocusedInspection', () => {
  it('只返回命中范围的节点，并按范围对选择每页最近的一对', () => {
    const result = buildFocusedInspection(
      [slideFixture()],
      [{ startLine: 10, endLine: 12 }, { startLine: 30, endLine: 32 }],
      new Map([['10:12', 1], ['30:32', 2]]),
    );

    expect(result).toMatchObject({
      ranges: [{ startLine: 10, endLine: 12 }, { startLine: 30, endLine: 32 }],
      nodes: [
        { rangeIndexes: [1], node: { nodeId: 'a' }, sourceRef: { kind: 'direct_creation' } },
        { rangeIndexes: [2], node: { nodeId: 'b' }, sourceRef: { kind: 'shared_creation', generatedNodeCount: 2 } },
        { rangeIndexes: [2], node: { nodeId: 'far' }, sourceRef: { kind: 'shared_creation', generatedNodeCount: 2 } },
      ],
      relations: [{
        slideNumber: 1,
        rangeIndexes: [1, 2],
        nodes: [{ nodeId: 'a' }, { nodeId: 'b' }],
        horizontal: { kind: 'gap', inches: 0.2 },
        vertical: { kind: 'overlap', inches: 0.5 },
      }],
    });
  });

  it('不生成全页矩阵，单一范围只返回命中节点', () => {
    const result = buildFocusedInspection(
      [slideFixture()],
      [{ startLine: 10, endLine: 12 }],
      new Map([['10:12', 1]]),
    );
    expect(result?.nodes.map((entry) => entry.node.nodeId)).toEqual(['a']);
    expect(result?.relations).toEqual([]);
  });
});

function slideFixture(): SceneGraphSlideSummary {
  const base = {
    slideNumber: 1,
    kind: 'shape',
    localBox: { x: 0, y: 0, w: 1, h: 0.5, unit: 'in' as const },
    zIndex: 0,
    sourceKind: 'generated' as const,
    children: [],
    capabilities: { tools: [] },
    diagnostics: [],
  };
  return {
    slideNumber: 1,
    textLayoutProvenance: {
      nodeCount: 0,
      advanceSources: {},
      fontIdentities: [],
      nodes: [],
    },
    referenceFrames: [],
    rootNode: {
      ...base,
      nodeId: 'slide:1',
      kind: 'slide',
      box: { x: 0, y: 0, w: 10, h: 5.625, unit: 'in' },
      localBox: { x: 0, y: 0, w: 10, h: 5.625, unit: 'in' },
      zIndex: -1,
      children: [
        { ...base, nodeId: 'a', box: { x: 1, y: 1, w: 1, h: 0.5, unit: 'in' }, sourceSpan: { startLine: 10, endLine: 12 } },
        { ...base, nodeId: 'b', box: { x: 2.2, y: 1, w: 1, h: 0.5, unit: 'in' }, sourceSpan: { startLine: 30, endLine: 32 } },
        { ...base, nodeId: 'far', box: { x: 8, y: 4, w: 1, h: 0.5, unit: 'in' }, sourceSpan: { startLine: 30, endLine: 32 } },
        { ...base, nodeId: 'ignored', box: { x: 1, y: 2, w: 1, h: 0.5, unit: 'in' }, sourceSpan: { startLine: 50, endLine: 51 } },
      ],
    },
  };
}
