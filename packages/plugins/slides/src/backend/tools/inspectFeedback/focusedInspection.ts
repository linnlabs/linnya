import type {
  PresentationInspectionSourceRange,
  SceneGraphNodeSummary,
  SceneGraphSlideSummary,
} from '@plugin/slides/shared';
import type {
  FocusedInspectionAxisRelation,
  FocusedInspectionNode,
  FocusedInspectionRelation,
  FocusedInspectionResult,
} from '../../features/presentationInspection';
import {
  buildSceneNodeDiagnosticSourceRef,
  toSceneDiagnosticNodeRef,
} from './diagnosticNodeFacts.js';
import { round3, walkSceneGraph } from './sceneGraph.js';

export const MAX_INSPECTION_SOURCE_RANGES = 4;

/**
 * 只围绕调用方点名的源码范围返回节点与最近几何关系。
 * 它不是新的全页距离矩阵，也不猜测“应该离多远”。
 */
export function buildFocusedInspection(
  sceneGraph: readonly SceneGraphSlideSummary[],
  ranges: readonly PresentationInspectionSourceRange[],
  sourceSpanUseCounts: ReadonlyMap<string, number>,
): FocusedInspectionResult | undefined {
  if (ranges.length === 0) return undefined;
  assertValidRanges(ranges);

  const nodes = collectFocusedNodes(sceneGraph, ranges, sourceSpanUseCounts);
  return {
    ranges: ranges.map((range) => ({ ...range })),
    nodes,
    relations: buildClosestRelations(nodes, ranges.length),
  };
}

function collectFocusedNodes(
  sceneGraph: readonly SceneGraphSlideSummary[],
  ranges: readonly PresentationInspectionSourceRange[],
  sourceSpanUseCounts: ReadonlyMap<string, number>,
): FocusedInspectionNode[] {
  const matches: FocusedInspectionNode[] = [];
  for (const slide of sceneGraph) {
    walkSceneGraph(slide.rootNode, (node) => {
      const sourceSpan = node.sourceSpan;
      if (!sourceSpan) return;
      const rangeIndexes = ranges.flatMap((range, index) => (
        sourceRangesIntersect(sourceSpan, range) ? [index + 1] : []
      ));
      if (rangeIndexes.length === 0) return;
      matches.push({
        rangeIndexes,
        slideNumber: node.slideNumber,
        node: toSceneDiagnosticNodeRef(node),
        sourceRef: buildSceneNodeDiagnosticSourceRef(node, undefined, sourceSpanUseCounts),
      });
    });
  }
  return matches.sort((left, right) => (
    left.slideNumber - right.slideNumber
    || left.node.nodeId.localeCompare(right.node.nodeId)
  ));
}

function buildClosestRelations(
  nodes: readonly FocusedInspectionNode[],
  rangeCount: number,
): FocusedInspectionRelation[] {
  const relations: FocusedInspectionRelation[] = [];
  const slides = [...new Set(nodes.map((entry) => entry.slideNumber))].sort((a, b) => a - b);
  for (let leftRange = 1; leftRange <= rangeCount; leftRange += 1) {
    for (let rightRange = leftRange + 1; rightRange <= rangeCount; rightRange += 1) {
      for (const slideNumber of slides) {
        const leftNodes = nodes.filter((entry) => (
          entry.slideNumber === slideNumber && entry.rangeIndexes.includes(leftRange)
        ));
        const rightNodes = nodes.filter((entry) => (
          entry.slideNumber === slideNumber && entry.rangeIndexes.includes(rightRange)
        ));
        const closest = findClosestDistinctPair(leftNodes, rightNodes);
        if (!closest) continue;
        relations.push({
          slideNumber,
          rangeIndexes: [leftRange, rightRange],
          nodes: [closest.left.node, closest.right.node],
          horizontal: axisRelation(
            closest.left.node.finalBox.x,
            closest.left.node.finalBox.w,
            closest.right.node.finalBox.x,
            closest.right.node.finalBox.w,
          ),
          vertical: axisRelation(
            closest.left.node.finalBox.y,
            closest.left.node.finalBox.h,
            closest.right.node.finalBox.y,
            closest.right.node.finalBox.h,
          ),
        });
      }
    }
  }
  return relations;
}

function findClosestDistinctPair(
  leftNodes: readonly FocusedInspectionNode[],
  rightNodes: readonly FocusedInspectionNode[],
): { readonly left: FocusedInspectionNode; readonly right: FocusedInspectionNode } | undefined {
  let best: {
    readonly left: FocusedInspectionNode;
    readonly right: FocusedInspectionNode;
    readonly score: number;
    readonly key: string;
  } | undefined;
  for (const left of leftNodes) {
    for (const right of rightNodes) {
      if (left.node.nodeId === right.node.nodeId) continue;
      const horizontal = axisRelation(
        left.node.finalBox.x,
        left.node.finalBox.w,
        right.node.finalBox.x,
        right.node.finalBox.w,
      );
      const vertical = axisRelation(
        left.node.finalBox.y,
        left.node.finalBox.h,
        right.node.finalBox.y,
        right.node.finalBox.h,
      );
      const horizontalGap = horizontal.kind === 'gap' ? horizontal.inches : 0;
      const verticalGap = vertical.kind === 'gap' ? vertical.inches : 0;
      const score = Math.hypot(horizontalGap, verticalGap);
      const key = `${left.node.nodeId}:${right.node.nodeId}`;
      if (!best || score < best.score || (score === best.score && key < best.key)) {
        best = { left, right, score, key };
      }
    }
  }
  return best;
}

function axisRelation(
  leftStart: number,
  leftSize: number,
  rightStart: number,
  rightSize: number,
): FocusedInspectionAxisRelation {
  const leftEnd = leftStart + leftSize;
  const rightEnd = rightStart + rightSize;
  if (leftEnd <= rightStart) return { kind: 'gap', inches: round3(rightStart - leftEnd) };
  if (rightEnd <= leftStart) return { kind: 'gap', inches: round3(leftStart - rightEnd) };
  return {
    kind: 'overlap',
    inches: round3(Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart)),
  };
}

function sourceRangesIntersect(
  left: PresentationInspectionSourceRange,
  right: PresentationInspectionSourceRange,
): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

function assertValidRanges(ranges: readonly PresentationInspectionSourceRange[]): void {
  if (ranges.length > MAX_INSPECTION_SOURCE_RANGES) {
    throw new Error(`Presentation inspection accepts at most ${MAX_INSPECTION_SOURCE_RANGES} source ranges`);
  }
  for (const range of ranges) {
    if (
      !Number.isInteger(range.startLine)
      || !Number.isInteger(range.endLine)
      || range.startLine <= 0
      || range.endLine < range.startLine
    ) {
      throw new Error('Presentation inspection source ranges must use positive inclusive line numbers');
    }
  }
}
