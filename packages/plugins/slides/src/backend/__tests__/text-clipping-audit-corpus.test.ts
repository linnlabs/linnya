import { describe, expect, it } from 'vitest';
import {
  summarizeSlideTextLayoutProvenance,
  type RunAdvanceProvider,
} from '@plugin/slides/shared';
import {
  TEXT_CLIPPING_AUDIT_CASES,
  createTextClippingAuditDeckSpec,
} from '../../../dev/fixtures/textClippingAuditFixture';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper.js';
import { applyTextLayoutToRenderModel } from '../engine/text/renderModelTextLayout.js';

const auditRunAdvanceProvider: RunAdvanceProvider = {
  getClusterAdvances(clusters, style) {
    const emInches = style.fontSizePt / 72;
    const trackingInches = (style.letterSpacingPt ?? 0) / 72;
    return {
      advances: clusters.map((cluster) => (
        emInches * (/^\s$/u.test(cluster) ? 0.32 : 0.62) + trackingInches
      )),
      source: 'heuristic',
    };
  },
};

describe('text clipping audit corpus', () => {
  it('保留真实 box、字号、字距和无 NBSP 正文，并进入 provenance', () => {
    const deckSpec = createTextClippingAuditDeckSpec();
    const renderModel = new RenderModelMapper().fromGeneratedDeck(
      'text-clipping-audit',
      1,
      deckSpec.title,
      deckSpec,
      { width: 10, height: 5.625 },
    );
    applyTextLayoutToRenderModel(renderModel, auditRunAdvanceProvider);

    for (const [index, testCase] of TEXT_CLIPPING_AUDIT_CASES.entries()) {
      const node = renderModel.slides[index]?.elements[0];
      expect(node?.kind).toBe('text');
      if (node?.kind !== 'text') {
        throw new Error(`Expected text clipping audit node ${testCase.id}`);
      }
      const run = node.paragraphs[0]?.runs[0];
      expect(run).toMatchObject({
        text: testCase.text,
        fontFamily: 'Avenir Next',
        fontSize: testCase.fontSizePt,
        fontWeight: 'bold',
        letterSpacing: testCase.letterSpacingPt,
      });
      expect(run?.text).not.toContain('\u00A0');
      expect(node.box).toMatchObject({
        x: testCase.box.x,
        y: testCase.box.y,
        w: testCase.box.w,
      });
      // generated resize-shape 可以按正式布局合同增高极矮文本框，但不能悄悄改动
      // 这次事故用于定位水平裁切的 x/y/width。
      expect(node.box.h).toBeGreaterThanOrEqual(testCase.box.h);
      expect(node.layout?.advanceSource).toBe('heuristic');

      const provenance = summarizeSlideTextLayoutProvenance(renderModel.slides[index]!);
      expect(provenance.attentionNodes).toHaveLength(1);
      expect(provenance.attentionNodes[0]).toMatchObject({
        nodeId: node.id,
        advanceSource: 'heuristic',
        maxLetterSpacingPt: testCase.letterSpacingPt,
      });
    }
  });
});
