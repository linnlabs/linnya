/**
 * P1-B.2 Tier-2 集成单测：验证 buildToolFeedbackPayload 的 includeHeuristics 开关
 * 是否正确控制 HeuristicLint 输出是否合并到 findings 中。
 */
import { describe, expect, it } from 'vitest';
import type { PresentationRenderModel, SpatialAnalysisSummary, SpatialNode } from '@plugin/slides/shared';
import { buildToolFeedbackPayload } from '../feedbackPayload.js';

const spatialAnalyzer = {
  async analyzeSpatial(input: { slideNodes: readonly SpatialNode[] }): Promise<SpatialAnalysisSummary> {
    const slide = input.slideNodes.find((node) => node.kind === 'slide');
    if (!slide) {
      throw new Error('missing slide node');
    }
    return {
      slideNumber: slide.slideNumber,
      sourceKind: slide.sourceKind,
      isEmptySlide: false,
      confidence: 1,
      summaryLines: [],
      sections: [],
      relations: [],
      debugLogs: [],
    };
  },
};

function makeModel(): PresentationRenderModel {
  /* 构造一个会触发 probable_title_too_small 的 deck：
   * 单页有 2 个文本元素，最大字号 10pt（< 14pt 阈值） */
  return {
    presentationId: 'p1',
    title: 'Test',
    version: 1,
    sourceKind: 'generated',
    slideSize: { width: 13.333, height: 7.5, unit: 'in' },
    slides: [
      {
        slideId: 'slide-1',
        index: 0,
        layoutKey: 'blank',
        background: { paint: { type: 'solid', color: '#FFFFFF' } },
        elements: [
          {
            id: 't1',
            kind: 'text',
            box: { x: 1, y: 1, w: 6, h: 0.6, unit: 'in' },
            zIndex: 0,
            paragraphs: [{
              runs: [{ text: 'Header', fontSize: 10 }],
            }],
          },
          {
            id: 't2',
            kind: 'text',
            box: { x: 1, y: 2, w: 6, h: 0.6, unit: 'in' },
            zIndex: 1,
            paragraphs: [{
              runs: [{ text: 'Body line', fontSize: 9 }],
            }],
          },
        ],
      },
    ],
    capabilities: {
      hasSemanticRender: true,
      hasReferencePreview: false,
      hasHitTest: true,
      hasSelection: true,
    },
  };
}

describe('buildToolFeedbackPayload — includeHeuristics findings', () => {
  it('does NOT emit probable_title_too_small when includeHeuristics is omitted', async () => {
    const payload = await buildToolFeedbackPayload(
      'p1',
      'v1',
      makeModel(),
      new Map(),
      { spatialAnalyzer },
    );
    const titleIssues = payload.findings.filter((finding) => finding.code === 'probable_title_too_small');
    expect(titleIssues).toHaveLength(0);
    expect(payload.findings.filter((finding) => finding.code === 'data_page_missing_source')).toHaveLength(0);
  });

  it('does NOT emit when includeHeuristics is explicitly false', async () => {
    const payload = await buildToolFeedbackPayload(
      'p1',
      'v1',
      makeModel(),
      new Map(),
      { includeHeuristics: false, spatialAnalyzer },
    );
    expect(payload.findings.filter((finding) => finding.code === 'probable_title_too_small')).toHaveLength(0);
  });

  it('DOES emit low-confidence info findings when includeHeuristics is true', async () => {
    const off = await buildToolFeedbackPayload('p1', 'v1', makeModel(), new Map(), {
      spatialAnalyzer,
    });
    const on = await buildToolFeedbackPayload(
      'p1',
      'v1',
      makeModel(),
      new Map(),
      { includeHeuristics: true, spatialAnalyzer },
    );
    const titleIssues = on.findings.filter((finding) => finding.code === 'probable_title_too_small');
    expect(titleIssues).toHaveLength(1);
    expect(titleIssues[0].severity).toBe('info');
    expect(titleIssues[0].confidence).toBe('low');
    expect(titleIssues[0].evidence).toMatchObject({
      kind: 'text_pattern',
      pattern: 'probable_title',
      fontSizePt: 10,
      fontSizeThresholdPt: 14,
    });
    expect(on.findings.length).toBeGreaterThan(off.findings.length);
  });

  it('keeps source identity and review remediation on the heuristic finding', async () => {
    const payload = await buildToolFeedbackPayload(
      'p1',
      'v1',
      makeModel(),
      new Map(),
      { includeHeuristics: true, spatialAnalyzer },
    );
    const finding = payload.findings.find((entry) => entry.code === 'probable_title_too_small');
    expect(finding).toMatchObject({
      sourceRefs: [expect.objectContaining({ kind: 'unavailable', nodeId: 't1' })],
      remediation: {
        disposition: 'review',
        targetNodeIds: ['t1'],
        verifyWith: ['render'],
      },
    });
  });

  it('does not change buildStatus (findings never redefine build availability)', async () => {
    const payload = await buildToolFeedbackPayload(
      'p1',
      'v1',
      makeModel(),
      new Map(),
      { includeHeuristics: true, spatialAnalyzer },
    );
    expect(payload.buildStatus).toEqual({ state: 'ready' });
  });
});
