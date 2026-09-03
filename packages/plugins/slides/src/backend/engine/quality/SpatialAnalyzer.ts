import { RelationGraph } from './RelationGraph.js';
import type { SpatialAnalysisSummary, SpatialNode, SpatialSectionSummary } from '@plugin/slides/shared';

const SECTION_BREAK_GAP = 0.3;

export class SpatialAnalyzer {
  private readonly relationGraph = new RelationGraph();

  analyze(slideNodes: SpatialNode[]): SpatialAnalysisSummary {
    const slide = slideNodes.find((node) => node.kind === 'slide');
    if (!slide) {
      throw new Error('SpatialAnalyzer requires a slide root node.');
    }

    const contentNodes = slideNodes
      .filter((node) => node.kind !== 'slide')
      .sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x);

    const relations = this.relationGraph.build(slideNodes);
    const sections = this.buildSections(slide, contentNodes);
    const summaryLines = sections.map((section) => `[${section.kind}] ${section.label}`);
    const debugLogs: string[] = [];

    if (slide.sourceKind === 'imported') {
      debugLogs.push('imported deck: spatial analysis uses geometry-only inference');
    }

    return {
      slideNumber: slide.slideNumber,
      sourceKind: slide.sourceKind,
      isEmptySlide: contentNodes.length === 0,
      confidence: slide.sourceKind === 'imported' ? 0.72 : 0.9,
      summaryLines,
      sections,
      relations,
      debugLogs,
    };
  }

  private buildSections(slide: SpatialNode, nodes: SpatialNode[]): SpatialSectionSummary[] {
    if (nodes.length === 0) {
      return [{
        id: `slide-${slide.slideNumber}-whitespace`,
        slideNumber: slide.slideNumber,
        kind: 'whitespace',
        label: '整页为空白',
        bounds: slide.box,
        nodeIds: [],
        confidence: 1,
      }];
    }

    const groups: SpatialNode[][] = [];
    let current: SpatialNode[] = [nodes[0]];
    for (let index = 1; index < nodes.length; index += 1) {
      const previous = nodes[index - 1];
      const next = nodes[index];
      const gap = next.box.y - (previous.box.y + previous.box.h);
      if (gap > SECTION_BREAK_GAP) {
        groups.push(current);
        current = [next];
        continue;
      }
      current.push(next);
    }
    groups.push(current);

    const sections = groups.map((group, index) => {
      const bounds = measureBounds(group);
      const kind = classifySectionKind(slide.box.h, bounds, index, groups.length);
      const label = describeSection(kind, group, bounds);
      return {
        id: `slide-${slide.slideNumber}-section-${index}`,
        slideNumber: slide.slideNumber,
        kind,
        label,
        bounds,
        nodeIds: group.map((node) => node.nodeId),
        confidence: slide.sourceKind === 'imported' ? 0.7 : 0.88,
      } satisfies SpatialSectionSummary;
    });

    const whitespaceH = round3(slide.box.h - Math.max(...sections.map((section) => section.bounds.y + section.bounds.h)));
    if (whitespaceH > 0.4) {
      sections.push({
        id: `slide-${slide.slideNumber}-whitespace-tail`,
        slideNumber: slide.slideNumber,
        kind: 'whitespace',
        label: `底部空白 ${whitespaceH}"`,
        bounds: {
          x: 0,
          y: round3(slide.box.h - whitespaceH),
          w: slide.box.w,
          h: whitespaceH,
        },
        nodeIds: [],
        confidence: 0.95,
      });
    }

    return sections;
  }
}

function classifySectionKind(
  slideHeight: number,
  bounds: SpatialNode['box'],
  index: number,
  total: number,
): SpatialSectionSummary['kind'] {
  if (index === 0 && bounds.y <= slideHeight * 0.22) {
    return 'header';
  }
  if (index === total - 1 && bounds.y >= slideHeight * 0.72) {
    return 'footer';
  }
  if (bounds.w <= 4 || bounds.h <= 1.6) {
    return 'cluster';
  }
  return 'content';
}

function describeSection(
  kind: SpatialSectionSummary['kind'],
  nodes: SpatialNode[],
  bounds: SpatialNode['box'],
): string {
  const labels = nodes
    .map((node) => node.text?.trim())
    .filter((value): value is string => Boolean(value))
    .slice(0, 2);
  const title = labels.length > 0 ? labels.join(' / ') : `${nodes.length} 个元素`;
  return `${title} (${round3(bounds.y)}-${round3(bounds.y + bounds.h)}")`;
}

function measureBounds(nodes: SpatialNode[]): SpatialNode['box'] {
  const left = Math.min(...nodes.map((node) => node.box.x));
  const top = Math.min(...nodes.map((node) => node.box.y));
  const right = Math.max(...nodes.map((node) => node.box.x + node.box.w));
  const bottom = Math.max(...nodes.map((node) => node.box.y + node.box.h));
  return {
    x: round3(left),
    y: round3(top),
    w: round3(right - left),
    h: round3(bottom - top),
  };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
