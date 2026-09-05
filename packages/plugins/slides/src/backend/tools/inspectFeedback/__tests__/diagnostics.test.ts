import { describe, expect, it } from 'vitest';
import type {
  PresentationRenderModel,
  SceneGraphNodeSummary,
  SpatialAnalysisSummary,
} from '@plugin/slides/shared';
import type { AestheticLintReport } from '../../../engine/quality/AestheticLint.js';
import {
  classifyDiagnosticPriority,
  type QualityDiagnosticDraft,
} from '../../../engine/quality/definitions';
import { collectFindings, evaluateQualityAnalysis } from '../diagnostics.js';
import { buildSceneGraph } from '../sceneGraph.js';

function makeAnalysis(drafts: readonly QualityDiagnosticDraft[] = []): AestheticLintReport {
  return {
    layout: { issueCount: drafts.length, issues: [...drafts] },
    aesthetic: [],
    metrics: {
      layoutWarnings: drafts.length,
      aestheticWarnings: 0,
      aestheticInfos: 0,
      averageAdjacentSimilarity: 0,
      maxAdjacentSimilarity: 0,
      repeatedAdjacentPairs: 0,
      longestRepetitionRun: 0,
    },
  };
}

describe('collectFindings', () => {
  it('把 pair overlap 规范化为 scene node，并保留双方精确源码位置', () => {
    const sceneGraph = buildSceneGraph(makeSourceTrackedRenderModel());
    const first = sceneGraph[0].rootNode.children[0];
    const second = sceneGraph[0].rootNode.children[1];
    if (!first || !second) throw new Error('fixture nodes missing');
    const draft: QualityDiagnosticDraft = {
      code: 'element_overlap',
      severity: 'warning',
      confidence: 'medium',
      slides: [1],
      evidence: {
        kind: 'node_overlap',
        nodes: [toNodeRef(first), toNodeRef(second)],
        intersection: { x: 1.2, y: 1.2, w: 2.8, h: 0.8, unit: 'in' },
        smallerCoveredRatio: 0.75,
        overlapClass: 'forbidden',
        intent: { assessment: 'unknown', signals: ['独立节点发生高覆盖重叠'] },
      },
    };

    const findings = collectFindings(makeAnalysis([draft]), sceneGraph, []);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'element_overlap',
      severity: 'warning',
      confidence: 'medium',
      slides: [1],
      evidence: {
        kind: 'node_overlap',
        nodes: [{ nodeId: 'node-a' }, { nodeId: 'node-b' }],
        overlapClass: 'forbidden',
      },
      sourceRefs: [
        { kind: 'direct_creation', nodeId: 'node-a', startLine: 10, endLine: 12, generatedNodeCount: 1 },
        { kind: 'direct_creation', nodeId: 'node-b', startLine: 20, endLine: 22, generatedNodeCount: 1 },
      ],
      remediation: {
        disposition: 'review',
        targetNodeIds: ['node-a', 'node-b'],
        verifyWith: ['inspect', 'render'],
      },
    });
  });

  it('节点级 finding 无法关联当前 snapshot 时直接拒绝', () => {
    const draft: QualityDiagnosticDraft = {
      code: 'zero_sized_renderable',
      severity: 'warning',
      confidence: 'high',
      slides: [1],
      evidence: {
        kind: 'node_size',
        node: {
          nodeId: 'missing-node',
          kind: 'text',
          label: 'missing',
          finalBox: { x: 0, y: 0, w: 0, h: 0, unit: 'in' },
          zIndex: 0,
        },
        zeroAxes: ['horizontal', 'vertical'],
        renderableBasis: 'text',
        thresholdInches: 0.001,
      },
    };

    expect(() => collectFindings(makeAnalysis([draft]), [], [])).toThrow(
      'Diagnostic node identity cannot be resolved: missing-node',
    );
  });

  it('完全空白页产生 slide scope 的结构化 finding', () => {
    const sceneGraph = buildSceneGraph(makeEmptyRenderModel());
    const spatial: SpatialAnalysisSummary = {
      slideNumber: 1,
      sourceKind: 'generated',
      isEmptySlide: true,
      confidence: 1,
      summaryLines: ['[whitespace] 整页为空白'],
      sections: [],
      relations: [],
      debugLogs: [],
    };

    expect(collectFindings(makeAnalysis(), sceneGraph, [spatial])).toEqual([
      expect.objectContaining({
        code: 'empty_slide',
        severity: 'info',
        confidence: 'high',
        slides: [1],
        evidence: expect.objectContaining({
          kind: 'content_presence',
          expectedContent: 'renderable_content',
          observedCount: 0,
        }),
      }),
    ]);
  });

  it('把 Yoga 压缩根因和 computed parent 越界投影为同一 root group', () => {
    const model = makeConstraintRenderModel();
    const sceneGraph = buildSceneGraph(model);
    const findings = collectFindings(
      evaluateQualityAnalysis(model),
      sceneGraph,
      [],
    );

    const root = findings.find((finding) => finding.code === 'layout_constraint_compressed');
    const symptom = findings.find(
      (finding) => finding.code === 'descendant_outside_computed_parent',
    );
    expect(root).toMatchObject({
      rootCauseKey: 'layout-constraint:layout:s1:root.0:horizontal',
      evidence: {
        kind: 'constraint_delta',
        node: { nodeId: 'card-bg' },
        parent: { nodeId: 'layout:s1:root' },
      },
    });
    expect(symptom).toMatchObject({
      rootCauseKey: 'layout-constraint:layout:s1:root.0:horizontal',
      evidence: {
        kind: 'parent_overflow',
        parent: { nodeId: 'layout:s1:root.0', label: 'View L5-12' },
        descendants: [{ nodeId: 'card-note' }],
        overflowSides: ['right'],
      },
      sourceRefs: expect.arrayContaining([
        expect.objectContaining({
          kind: 'direct_creation',
          nodeId: 'layout:s1:root.0',
          startLine: 5,
          endLine: 12,
          generatedNodeCount: 1,
        }),
        expect.objectContaining({
          kind: 'direct_creation',
          nodeId: 'card-note',
          startLine: 8,
          endLine: 9,
          generatedNodeCount: 1,
        }),
      ]),
    });
  });

  it('把最终图表标签事实接入标准 P1 finding 与源码定位', () => {
    const model = makeCrowdedChartRenderModel();
    const sceneGraph = buildSceneGraph(model);
    const findings = collectFindings(evaluateQualityAnalysis(model), sceneGraph, []);

    const capacity = findings.find((finding) => finding.code === 'chart_label_capacity_exceeded');
    expect(capacity).toMatchObject({
      code: 'chart_label_capacity_exceeded',
      severity: 'warning',
      confidence: 'medium',
      evidence: {
        kind: 'chart_readability',
        assessment: 'label_capacity_exceeded',
        node: { nodeId: 'chart-crowded', kind: 'chart' },
        channel: 'data_labels',
        labelCount: 12,
      },
      sourceRefs: [{
        kind: 'direct_creation',
        nodeId: 'chart-crowded',
        startLine: 90,
        endLine: 104,
        generatedNodeCount: 1,
      }],
      remediation: {
        disposition: 'fix',
        targetNodeIds: ['chart-crowded'],
        verifyWith: ['inspect', 'render'],
      },
    });
    if (!capacity) throw new Error('chart capacity finding missing');
    expect(classifyDiagnosticPriority(capacity)).toBe('P1');
  });
});

function toNodeRef(node: SceneGraphNodeSummary) {
  return {
    nodeId: node.nodeId,
    kind: node.kind,
    label: node.nodeId,
    finalBox: { ...node.box, unit: 'in' as const },
    zIndex: node.zIndex,
    ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}),
  };
}

function makeEmptyRenderModel(): PresentationRenderModel {
  return {
    presentationId: 'deck-empty',
    title: 'Empty deck',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: [{
      slideId: 'slide-1',
      index: 0,
      layoutKey: 'blank',
      background: { paint: { type: 'solid', color: '#FFFFFF' } },
      elements: [],
    }],
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
  };
}

function makeCrowdedChartRenderModel(): PresentationRenderModel {
  return {
    presentationId: 'deck-chart',
    title: 'Chart diagnostics',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625 },
    slides: [{
      index: 0,
      elements: [{
        id: 'chart-crowded',
        kind: 'chart',
        chartType: 'doughnut',
        box: { x: 2, y: 2, w: 4, h: 0.7 },
        zIndex: 1,
        sourceSpan: { startLine: 90, endLine: 104 },
        categories: Array.from({ length: 12 }, (_, index) => `部件${index + 1}`),
        series: [{
          name: 'BOM',
          values: Array.from({ length: 12 }, () => 1),
        }],
        palette: ['#1F4F8A'],
        legend: { visible: false },
        dataLabels: {
          visible: true,
          position: 'outside',
          labelStyle: { fontSize: 10 },
        },
      }],
    }],
  };
}

function makeSourceTrackedRenderModel(): PresentationRenderModel {
  const model = makeEmptyRenderModel();
  return {
    ...model,
    presentationId: 'deck-1',
    slides: [{
      ...model.slides[0],
      elements: [
        {
          id: 'node-a',
          kind: 'text',
          box: { x: 1, y: 1, w: 3, h: 1, unit: 'in' },
          zIndex: 0,
          paragraphs: [],
          sourceSpan: { startLine: 10, endLine: 12 },
          editableTarget: { elementId: 'element-a', operations: ['modify_geometry'] },
        },
        {
          id: 'node-b',
          kind: 'text',
          box: { x: 1.2, y: 1.2, w: 3, h: 1, unit: 'in' },
          zIndex: 1,
          paragraphs: [],
          sourceSpan: { startLine: 20, endLine: 22 },
          editableTarget: { elementId: 'element-b', operations: ['modify_geometry'] },
        },
      ],
    }],
  };
}

function makeConstraintRenderModel(): PresentationRenderModel {
  const model = makeEmptyRenderModel();
  const slideBox = { x: 0, y: 0, w: 10, h: 5.625, unit: 'in' as const };
  const parentBox = { x: 1, y: 1, w: 2, h: 1, unit: 'in' as const };
  const childBox = { x: 2.7, y: 1.2, w: 0.8, h: 0.3, unit: 'in' as const };
  return {
    ...model,
    presentationId: 'deck-constraint',
    slides: [{
      ...model.slides[0],
      elements: [
        {
          id: 'card-bg',
          kind: 'shape',
          box: parentBox,
          zIndex: 0,
          geometry: { type: 'preset', name: 'rect' },
          sourceSpan: { startLine: 5, endLine: 12 },
          layoutConstraintEvidence: {
            layoutNodeId: 'layout:s1:root.0',
            positionMode: 'flow',
            declared: { widthInches: 4 },
            finalBox: parentBox,
            computedRatios: { widthToDeclared: 0.5 },
            parent: {
              nodeId: 'layout:s1:root',
              kind: 'slide',
              label: 'Slide',
              finalBox: slideBox,
              zIndex: -1,
            },
            clipSemantics: 'visible',
          },
        },
        {
          id: 'card-note',
          kind: 'text',
          box: childBox,
          zIndex: 1,
          paragraphs: [{ runs: [{ text: 'Capacity revenue' }] }],
          sourceSpan: { startLine: 8, endLine: 9 },
          layoutConstraintEvidence: {
            layoutNodeId: 'layout:s1:root.0.0',
            positionMode: 'absolute',
            declared: { leftInches: 1.7, widthInches: 0.8 },
            finalBox: childBox,
            computedRatios: { widthToDeclared: 1 },
            parent: {
              nodeId: 'layout:s1:root.0',
              kind: 'layout_container',
              label: 'View L5-12',
              finalBox: parentBox,
              zIndex: -1,
              parentNodeId: 'layout:s1:root',
              sourceSpan: { startLine: 5, endLine: 12 },
            },
            clipSemantics: 'visible',
          },
        },
      ],
    }],
  };
}
