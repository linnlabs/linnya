import { describe, expect, it } from 'vitest';
import {
  admitDiagnosticFinding,
  admitDiagnosticFindings,
  classifyDiagnosticPriority,
  DIAGNOSTIC_CODE_REGISTRY,
  DIAGNOSTIC_CODES,
} from './index';

const node = {
  nodeId: 'node-1',
  kind: 'text',
  label: '标题',
  finalBox: { x: -0.2, y: 0.4, w: 2, h: 0.5, unit: 'in' as const },
  zIndex: 1,
};

function outOfBoundsFinding() {
  return {
    findingId: 'finding-1',
    code: 'out_of_bounds',
    severity: 'warning',
    confidence: 'high',
    slides: [1],
    evidence: {
      kind: 'node_bounds',
      assessment: 'overflow',
      node,
      referenceBox: { x: 0, y: 0, w: 13.333, h: 7.5, unit: 'in' },
      margins: { left: -0.2, right: 11.533, top: 0.4, bottom: 6.6 },
      violatedSides: ['left'],
      thresholdInches: 0,
      policyId: 'slide_bounds',
      fullBleedAxes: [],
    },
    sourceRefs: [{
      kind: 'direct_creation',
      slideNumber: 1,
      nodeId: 'node-1',
      locator: 'deck.js',
      startLine: 20,
      endLine: 24,
      generatedNodeCount: 1,
    }],
    remediation: {
      disposition: 'fix',
      targetNodeIds: ['node-1'],
      verifyWith: ['inspect', 'render'],
    },
  };
}

describe('DiagnosticFinding contract', () => {
  it('registers every code once with one evidence family', () => {
    expect(Object.keys(DIAGNOSTIC_CODE_REGISTRY).sort()).toEqual([...DIAGNOSTIC_CODES].sort());
    for (const code of DIAGNOSTIC_CODES) {
      expect(DIAGNOSTIC_CODE_REGISTRY[code].evidenceKind).toBeTruthy();
    }
  });

  it('admits a complete code-specific finding', () => {
    expect(admitDiagnosticFinding(outOfBoundsFinding()).code).toBe('out_of_bounds');
  });

  it('rejects a code paired with another evidence family', () => {
    const invalid = {
      ...outOfBoundsFinding(),
      code: 'element_overlap',
    };
    expect(() => admitDiagnosticFinding(invalid)).toThrow();
  });

  it('rejects message-only fields and missing source identity', () => {
    const { sourceRefs: _sourceRefs, ...withoutSource } = outOfBoundsFinding();
    expect(() => admitDiagnosticFinding({ ...withoutSource, message: 'overflow' })).toThrow();
  });

  it('enforces registry severity and verification policy', () => {
    const invalid = {
      ...outOfBoundsFinding(),
      severity: 'info',
      remediation: { disposition: 'fix', targetNodeIds: ['node-1'], verifyWith: ['render'] },
    };
    expect(() => admitDiagnosticFinding(invalid)).toThrow();
  });

  it('rejects duplicate ids in one admitted finding set', () => {
    expect(() => admitDiagnosticFindings([outOfBoundsFinding(), outOfBoundsFinding()])).toThrow(
      'Duplicate diagnostic finding id',
    );
  });

  it('derives action priority without duplicating it into finding facts', () => {
    expect(classifyDiagnosticPriority(outOfBoundsFinding())).toBe('P0');
    expect(classifyDiagnosticPriority({
      code: 'font_style_substituted',
      severity: 'warning',
      confidence: 'high',
    })).toBe('P1');
    expect(classifyDiagnosticPriority({
      code: 'element_overlap',
      severity: 'warning',
      confidence: 'medium',
    })).toBe('P2');
    expect(classifyDiagnosticPriority({
      code: 'chart_label_capacity_exceeded',
      severity: 'warning',
      confidence: 'medium',
    })).toBe('P1');
    expect(classifyDiagnosticPriority({
      code: 'text_single_glyph_last_line',
      severity: 'warning',
      confidence: 'medium',
    })).toBe('P1');
  });

  it('keeps chart issue codes bound to their exact readability evidence', () => {
    const finding = {
      findingId: 'chart-capacity-1',
      code: 'chart_label_capacity_exceeded',
      severity: 'warning',
      confidence: 'medium',
      slides: [2],
      evidence: {
        kind: 'chart_readability',
        assessment: 'label_capacity_exceeded',
        node: { ...node, nodeId: 'chart-1', kind: 'chart' },
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
        capacityRatio: 1.86,
        thresholdRatio: 1.35,
      },
      sourceRefs: [{
        kind: 'direct_creation',
        slideNumber: 2,
        nodeId: 'chart-1',
        locator: 'deck.js',
        startLine: 80,
        endLine: 90,
        generatedNodeCount: 1,
      }],
      remediation: {
        disposition: 'fix',
        targetNodeIds: ['chart-1'],
        verifyWith: ['inspect', 'render'],
      },
    };

    expect(admitDiagnosticFinding(finding).code).toBe('chart_label_capacity_exceeded');
    expect(() => admitDiagnosticFinding({
      ...finding,
      code: 'chart_identity_missing',
    })).toThrow();
  });
});
