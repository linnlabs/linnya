import { describe, expect, it } from 'vitest';
import type { DiagnosticFinding } from '../../../engine/quality/definitions';
import type { DiagnosticToolFeedbackPayload } from '../definitions/presentationInspection';
import { buildInspectionObservation } from './buildInspectionObservation';

describe('buildInspectionObservation', () => {
  it('同一事实只投影一次，并且节点与源码事实只声明一次', () => {
    const finding = outOfBoundsFinding();
    const observation = buildInspectionObservation({
      presentationId: 'deck-1',
      versionId: 'version-7',
      totalSlideCount: 12,
      shownSlideNumbers: [3],
      truncated: true,
      feedback: feedback([finding, { ...finding, findingId: 'duplicate-id' }]),
    });

    expect(observation).toContain('id=deck-1 | v=version-7 | pages=3/12+');
    expect(observation).toContain('summary | raw=2 | unique=1 | roots=0 | P0=1 | P1=0 | P2=0');
    expect(observation.match(/^N1 \|/gm)).toHaveLength(1);
    expect(observation.match(/^S1 \|/gm)).toHaveLength(1);
    expect(observation).toContain('priority P0 | fix deterministic issues first');
    expect(observation).toContain('F1 | P0/high | slides=3 | out_of_bounds');
    expect(observation).toContain('node=N1 assessment=overflow sides=right');
    expect(observation).toContain('target=N1 | verify=inspect+render | src=S1');
  });

  it('显式约束根因只按 rootCauseKey 归组，不从几何相似性猜测', () => {
    const root = compressedFinding();
    const symptom: DiagnosticFinding = {
      findingId: 'diag:descendant',
      code: 'descendant_outside_computed_parent',
      severity: 'warning',
      confidence: 'high',
      slides: [2],
      rootCauseKey: 'constraint:parent:horizontal',
      evidence: {
        kind: 'parent_overflow',
        parent: root.evidence.node,
        descendants: [root.evidence.parent],
        overflowSides: ['right'],
        clipSemantics: 'visible',
      },
      sourceRefs: root.sourceRefs,
      remediation: {
        disposition: 'fix',
        targetNodeIds: [root.evidence.node.nodeId, root.evidence.parent.nodeId],
        verifyWith: ['inspect', 'render'],
      },
    };

    const observation = buildInspectionObservation({
      presentationId: 'deck-2',
      versionId: 'version-2',
      totalSlideCount: 2,
      shownSlideNumbers: [2],
      truncated: false,
      feedback: feedback([symptom, root]),
    });

    expect(observation).toContain('roots=1');
    expect(observation).toContain('G1 | P0 | declared-root | findings=2');
    expect(observation).toContain('symptom | F2');
  });

  it('按相同 element 源码控制点聚合重复问题，并让 P0 排在 P2 前面', () => {
    const first = shortNumericFinding('diag:num-1', 2, 'node-1');
    const second = shortNumericFinding('diag:num-2', 4, 'node-2');
    const slideOnly = {
      ...shortNumericFinding('diag:num-slide', 3, 'node-slide'),
      sourceRefs: [{
        precision: 'slide' as const,
        slideNumber: 3,
        nodeId: 'node-slide',
        locator: 'deck.js',
        startLine: 40,
        endLine: 40,
      }],
    } satisfies DiagnosticFinding;
    const review = {
      ...outOfBoundsFinding(),
      findingId: 'diag:overlap-review',
      code: 'element_overlap' as const,
      severity: 'warning' as const,
      confidence: 'medium' as const,
      slides: [1],
      evidence: {
        kind: 'node_overlap' as const,
        nodes: [node('review-a', 1), node('review-b', 1.5)] as const,
        intersection: { x: 1.5, y: 1, w: 1.5, h: 1, unit: 'in' as const },
        smallerCoveredRatio: 0.75,
        overlapClass: 'forbidden' as const,
        intent: { assessment: 'unknown' as const, signals: ['需要结合渲染复核'] },
      },
      sourceRefs: [{
        precision: 'element' as const,
        slideNumber: 1,
        nodeId: 'review-a',
        locator: 'deck.js',
        startLine: 80,
        endLine: 80,
      }],
      remediation: {
        disposition: 'review' as const,
        targetNodeIds: ['review-a', 'review-b'],
        verifyWith: ['inspect', 'render'] as const,
      },
    } satisfies DiagnosticFinding;

    const observation = buildInspectionObservation({
      presentationId: 'deck-3',
      versionId: 'version-3',
      totalSlideCount: 4,
      shownSlideNumbers: [1, 2, 4],
      truncated: false,
      feedback: feedback([review, slideOnly, second, first]),
    });

    expect(observation).toContain('summary | raw=4 | unique=4 | roots=1 | P0=3 | P1=0 | P2=1');
    expect(observation).toContain('S1 | deck.js:40-40 precision=element shared=2');
    expect(observation).toContain('G1 | P0 | shared-source | code=short_numeric_text_wrapped | findings=2 | src=S1');
    // 两条 element 精度 finding 共用一次 action；slide 精度 finding 不能被误归因，单独保留一次。
    expect(observation.match(/增大文本框宽度或使用不指定宽度的单行文本/g)).toHaveLength(2);
    expect(observation.indexOf('priority P0')).toBeLessThan(observation.indexOf('priority P2'));
  });

  it('用标准 P1 投影图表标签容量，不重复倾倒图表数据', () => {
    const finding: DiagnosticFinding = {
      findingId: 'diag:chart-capacity',
      code: 'chart_label_capacity_exceeded',
      severity: 'warning',
      confidence: 'medium',
      slides: [17],
      evidence: {
        kind: 'chart_readability',
        assessment: 'label_capacity_exceeded',
        node: { ...node('chart-17', 4), kind: 'chart', label: 'BOM 价值量' },
        chartType: 'doughnut',
        categoryCount: 12,
        seriesCount: 1,
        legendVisible: false,
        dataLabelsVisible: true,
        channel: 'data_labels',
        direction: 'vertical',
        labelCount: 12,
        maxLabel: '精密减速器',
        fontSizePt: 10,
        availableSpanInches: 0.56,
        estimatedRequiredSpanInches: 1.04,
        capacityRatio: 1.857,
        thresholdRatio: 1.35,
      },
      sourceRefs: [{
        precision: 'element',
        slideNumber: 17,
        nodeId: 'chart-17',
        locator: 'deck.js',
        startLine: 810,
        endLine: 824,
      }],
      remediation: {
        disposition: 'fix',
        targetNodeIds: ['chart-17'],
        verifyWith: ['inspect', 'render'],
      },
    };

    const observation = buildInspectionObservation({
      presentationId: 'deck-chart',
      versionId: 'version-chart',
      totalSlideCount: 22,
      shownSlideNumbers: [17],
      truncated: false,
      feedback: feedback([finding]),
    });

    expect(observation).toContain('summary | raw=1 | unique=1 | roots=0 | P0=0 | P1=1 | P2=0');
    expect(observation).toContain('priority P1 | verify fidelity issues before editing');
    expect(observation).toContain('chart=doughnut channel=data_labels direction=vertical labels=12');
    expect(observation).toContain('span=1.04/0.56in ratio=1.857/1.35');
    expect(observation).toContain('减少标签、扩大图表或调整标签位置与字号');
    expect(observation).not.toContain('seriesValues');
  });

  it('用 rows[row][column] 紧凑定位表格单元格末行孤字', () => {
    const tableNode = { ...node('table-16', 0.36), kind: 'table' as const, label: '代表性交易' };
    const finding: DiagnosticFinding = {
      findingId: 'diag:table-orphan',
      code: 'text_single_glyph_last_line',
      severity: 'warning',
      confidence: 'medium',
      slides: [16],
      evidence: {
        kind: 'text_layout',
        issue: 'single_glyph_last_line',
        node: tableNode,
        textPreview: '双向许可＋共同发现',
        basis: 'finalized',
        actualLineCount: 2,
        paragraphIndex: 0,
        tableCell: { rowIndex: 6, columnIndex: 3 },
        orphanText: '现',
        contentWidthInches: 1.2,
        contentHeightInches: 0.32,
        maxLineWidthInches: 1.18,
        horizontalOverflow: false,
        verticalOverflow: false,
        hiddenLineCount: 0,
      },
      sourceRefs: [{
        precision: 'element',
        slideNumber: 16,
        nodeId: 'table-16',
        locator: 'deck.js',
        startLine: 390,
        endLine: 390,
      }],
      remediation: {
        disposition: 'fix',
        targetNodeIds: ['table-16'],
        verifyWith: ['inspect', 'render'],
      },
    };

    const observation = buildInspectionObservation({
      presentationId: 'deck-table',
      versionId: 'version-table',
      totalSlideCount: 22,
      shownSlideNumbers: [16],
      truncated: false,
      feedback: feedback([finding]),
    });

    expect(observation).toContain('P0=0 | P1=1 | P2=0');
    expect(observation).toContain('issue=single_glyph_last_line basis=finalized lines=2 cell=rows[6][3] paragraph=0 orphan="现"');
    expect(observation).toContain('调整列宽，避免末行只剩一个字');
  });
});

function feedback(findings: readonly DiagnosticFinding[]): DiagnosticToolFeedbackPayload {
  return {
    artifact: { presentationId: 'deck-1', versionId: 'version-7', slideCount: 12 },
    pageSummaries: [],
    sceneGraph: [],
    spatialAnalysis: [],
    buildStatus: { state: 'ready' },
    findings,
  };
}

function node(nodeId: string, x: number) {
  return {
    nodeId,
    kind: 'text',
    label: nodeId,
    finalBox: { x, y: 1, w: 2, h: 1, unit: 'in' as const },
    zIndex: 1,
    parentNodeId: 'slide:3',
  };
}

function outOfBoundsFinding(): DiagnosticFinding {
  return {
    findingId: 'diag:oob',
    code: 'out_of_bounds',
    severity: 'warning',
    confidence: 'high',
    slides: [3],
    evidence: {
      kind: 'node_bounds',
      assessment: 'overflow',
      node: node('node-a', 9),
      referenceBox: { x: 0, y: 0, w: 10, h: 5.625, unit: 'in' },
      margins: { left: 9, right: -1, top: 1, bottom: 3.625 },
      violatedSides: ['right'],
      thresholdInches: 0,
      policyId: 'slide_bounds',
      fullBleedAxes: [],
    },
    sourceRefs: [{
      precision: 'element',
      slideNumber: 3,
      nodeId: 'node-a',
      locator: 'deck.js',
      startLine: 20,
      endLine: 22,
    }],
    remediation: {
      disposition: 'fix',
      targetNodeIds: ['node-a'],
      verifyWith: ['inspect', 'render'],
    },
  };
}

function compressedFinding(): Extract<DiagnosticFinding, { code: 'layout_constraint_compressed' }> {
  return {
    findingId: 'diag:compressed',
    code: 'layout_constraint_compressed',
    severity: 'warning',
    confidence: 'high',
    slides: [2],
    rootCauseKey: 'constraint:parent:horizontal',
    evidence: {
      kind: 'constraint_delta',
      node: node('parent', 1),
      parent: node('slide:2', 0),
      axis: 'horizontal',
      positionMode: 'flow',
      declaredInches: 6,
      finalInches: 3,
      finalToDeclaredRatio: 0.5,
    },
    sourceRefs: [{
      precision: 'slide',
      slideNumber: 2,
      locator: 'deck.js',
      startLine: 5,
      endLine: 12,
    }],
    remediation: {
      disposition: 'fix',
      targetNodeIds: ['parent', 'slide:2'],
      verifyWith: ['inspect', 'render'],
    },
  };
}

function shortNumericFinding(
  findingId: string,
  slideNumber: number,
  nodeId: string,
): Extract<DiagnosticFinding, { code: 'short_numeric_text_wrapped' }> {
  const numericNode = node(nodeId, 1);
  return {
    findingId,
    code: 'short_numeric_text_wrapped',
    severity: 'warning',
    confidence: 'high',
    slides: [slideNumber],
    evidence: {
      kind: 'text_layout',
      issue: 'short_numeric_wrap',
      node: numericNode,
      textPreview: '01',
      basis: 'finalized',
      actualLineCount: 2,
      contentWidthInches: 0.2,
      contentHeightInches: 0.4,
      maxLineWidthInches: 0.1,
      horizontalOverflow: false,
      verticalOverflow: false,
      hiddenLineCount: 0,
    },
    sourceRefs: [{
      precision: 'element',
      slideNumber,
      nodeId,
      locator: 'deck.js',
      startLine: 40,
      endLine: 40,
    }],
    remediation: {
      disposition: 'fix',
      targetNodeIds: [nodeId],
      verifyWith: ['inspect', 'render'],
    },
  };
}
