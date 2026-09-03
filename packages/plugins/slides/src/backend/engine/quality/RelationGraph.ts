import type { RelationEdge, SpatialNode } from '@plugin/slides/shared';
import {
  annotateLineNodeSemantics,
  classifyOverlap,
  containsWithPadding,
} from './SpatialSemantics.js';

const ALIGN_EPSILON = 0.02;
const ROW_EPSILON = 0.12;
const DISTRIBUTION_EPSILON = 0.06;

export class RelationGraph {
  build(slideNodes: SpatialNode[]): RelationEdge[] {
    const nodes = annotateLineNodeSemantics(
      slideNodes.filter((node) => node.kind !== 'slide'),
    );
    const relations: RelationEdge[] = [];
    if (nodes.length === 0) {
      return relations;
    }

    const slideNumber = nodes[0].slideNumber;

    const leftAligned = groupBy(nodes, (node) => quantize(node.box.x, ALIGN_EPSILON)).filter((group) => group.length >= 2);
    for (const group of leftAligned) {
      relations.push({
        type: 'align_left',
        slideNumber,
        nodeIds: group.map((node) => node.nodeId),
        description: `左对齐: ${group.map((node) => node.nodeId).join(', ')}`,
        confidence: 0.9,
      });
    }

    const centered = groupBy(nodes, (node) => quantize(node.box.x + node.box.w / 2, ALIGN_EPSILON)).filter((group) => group.length >= 2);
    for (const group of centered) {
      relations.push({
        type: 'align_center_x',
        slideNumber,
        nodeIds: group.map((node) => node.nodeId),
        description: `水平中心对齐: ${group.map((node) => node.nodeId).join(', ')}`,
        confidence: 0.85,
      });
    }

    const sameRows = groupBy(
      nodes.filter((node) => node.parentNodeId == null || node.parentNodeId.startsWith('slide:')),
      (node) => quantize(node.box.y + node.box.h / 2, ROW_EPSILON),
    ).filter((group) => group.length >= 2);
    for (const group of sameRows) {
      const sorted = [...group].sort((left, right) => left.box.x - right.box.x);
      relations.push({
        type: 'same_row',
        slideNumber,
        nodeIds: sorted.map((node) => node.nodeId),
        description: `同一行: ${sorted.map((node) => node.nodeId).join(', ')}`,
        confidence: 0.82,
      });
      const gaps = sorted.slice(1).map((node, index) => round3(node.box.x - (sorted[index].box.x + sorted[index].box.w)));
      if (gaps.length >= 2 && Math.max(...gaps) - Math.min(...gaps) <= DISTRIBUTION_EPSILON) {
        relations.push({
          type: 'distribute_h',
          slideNumber,
          nodeIds: sorted.map((node) => node.nodeId),
          description: `水平等距分布: ${sorted.map((node) => node.nodeId).join(', ')}`,
          confidence: 0.88,
          gap: round3(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length),
        });
      }
    }

    const sameColumns = groupBy(nodes, (node) => quantize(node.box.x + node.box.w / 2, ROW_EPSILON)).filter((group) => group.length >= 2);
    for (const group of sameColumns) {
      relations.push({
        type: 'same_column',
        slideNumber,
        nodeIds: group.map((node) => node.nodeId),
        description: `同一列: ${group.map((node) => node.nodeId).join(', ')}`,
        confidence: 0.8,
      });
    }

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const left = nodes[i];
        const right = nodes[j];
        if (containsWithPadding(left.box, right.box, -0.02)) {
          relations.push({
            type: 'contain',
            slideNumber,
            nodeIds: [left.nodeId, right.nodeId],
            description: `${left.nodeId} 包含 ${right.nodeId}`,
            confidence: 0.9,
          });
        } else if (containsWithPadding(right.box, left.box, -0.02)) {
          relations.push({
            type: 'contain',
            slideNumber,
            nodeIds: [right.nodeId, left.nodeId],
            description: `${right.nodeId} 包含 ${left.nodeId}`,
            confidence: 0.9,
          });
        }

        const overlapType = classifyOverlap(left, right);
        if (overlapType !== 'none') {
          relations.push({
            type: 'overlap',
            slideNumber,
            nodeIds: [left.nodeId, right.nodeId],
            description: `${left.nodeId} 与 ${right.nodeId} 重叠 (${overlapType})`,
            confidence: overlapType === 'forbidden' ? 0.95 : 0.75,
            overlapType,
          });
          if (left.zIndex !== right.zIndex) {
            const ordered = left.zIndex < right.zIndex ? [left, right] : [right, left];
            relations.push({
              type: 'z_before',
              slideNumber,
              nodeIds: ordered.map((node) => node.nodeId),
              description: `${ordered[0].nodeId} 位于 ${ordered[1].nodeId} 之后`,
              confidence: 0.7,
            });
          }
        }
      }
    }

    return dedupeRelations(relations);
  }
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
      continue;
    }
    groups.set(key, [item]);
  }
  return [...groups.values()];
}

function quantize(value: number, epsilon: number): string {
  return String(Math.round(value / epsilon) * epsilon);
}

function dedupeRelations(relations: RelationEdge[]): RelationEdge[] {
  const seen = new Set<string>();
  const result: RelationEdge[] = [];
  for (const relation of relations) {
    const key = `${relation.type}:${relation.nodeIds.join('|')}:${relation.overlapType ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(relation);
  }
  return result;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
