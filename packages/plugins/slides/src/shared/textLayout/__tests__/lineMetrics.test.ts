import { describe, expect, it } from 'vitest';
import type { RenderParagraph } from '../../renderModel';
import type { FontMetricsProvider, RunMeasureStyle } from '../index';
import {
  DEFAULT_TEXT_LINE_SPACING_MULTIPLE,
  SINGLE_SPACING_LINE_HEIGHT_EM,
  measureLineMetrics,
} from '../index';

const metricsProvider: FontMetricsProvider = {
  getMetrics(_style: RunMeasureStyle) {
    return {
      ascent: 0.14,
      descent: 0.04,
      lineGap: 0.02,
    };
  },
};

describe('measureLineMetrics', () => {
  it('uses the shared default line-height multiplier when paragraph lineSpacing is omitted', () => {
    const paragraph: RenderParagraph = {
      runs: [{
        text: 'Default line height',
        fontSize: 12,
      }],
    };

    const metrics = measureLineMetrics(paragraph, {
      width: 1,
      slices: [{
        paragraphIndex: 0,
        runIndex: 0,
        text: 'Default line height',
        x: 0,
        width: 1,
      }],
    }, 1);

    expect(metrics.height).toBeCloseTo((12 * SINGLE_SPACING_LINE_HEIGHT_EM * DEFAULT_TEXT_LINE_SPACING_MULTIPLE) / 72, 6);
  });

  it('uses paragraph multiple line spacing as the line-height authority', () => {
    const paragraph: RenderParagraph = {
      lineSpacing: { kind: 'multiple', value: 1.5 },
      runs: [{
        text: 'Paragraph line spacing',
        fontSize: 12,
      }],
    };

    const metrics = measureLineMetrics(paragraph, {
      width: 1,
      slices: [{
        paragraphIndex: 0,
        runIndex: 0,
        text: 'Paragraph line spacing',
        x: 0,
        width: 1,
      }],
    }, 1);

    expect(metrics.height).toBeCloseTo((12 * SINGLE_SPACING_LINE_HEIGHT_EM * 1.5) / 72, 6);
  });

  it('keeps PowerPoint multiple spacing independent from oversized font metadata', () => {
    const paragraph: RenderParagraph = {
      lineSpacing: { kind: 'multiple', value: 1.18 },
      runs: [{
        text: '免费退货，平台先承担退货运费与逆向物流处理费。',
        fontFamily: 'Arial Unicode MS',
        fontSize: 7.4,
      }],
    };
    const oversizedMetricsProvider: FontMetricsProvider = {
      getMetrics() {
        return {
          ascent: (7.4 * 1.47080078125) / 72,
          descent: (7.4 * 0.27099609375) / 72,
          lineGap: 0,
        };
      },
    };

    const metrics = measureLineMetrics(paragraph, {
      width: 1,
      slices: [{
        paragraphIndex: 0,
        runIndex: 0,
        text: paragraph.runs[0]!.text,
        x: 0,
        width: 1,
      }],
    }, 1, 0, oversizedMetricsProvider, (run) => ({
      fontFamily: run.fontFamily ?? 'Arial Unicode MS',
      fontSizePt: run.fontSize ?? 7.4,
      bold: false,
      italic: false,
      script: 'eastAsian',
    }));

    expect(metrics.height * 72).toBeCloseTo(7.4 * SINGLE_SPACING_LINE_HEIGHT_EM * 1.18, 3);
  });

  it('preserves exact point line spacing as a fixed line height', () => {
    const paragraph: RenderParagraph = {
      lineSpacing: { kind: 'exactPt', value: 18 },
      runs: [{
        text: 'Exact spacing',
        fontSize: 12,
      }],
    };

    const metrics = measureLineMetrics(paragraph, {
      width: 1,
      slices: [{
        paragraphIndex: 0,
        runIndex: 0,
        text: 'Exact spacing',
        x: 0,
        width: 1,
      }],
    }, 1);

    expect(metrics.height).toBeCloseTo(18 / 72, 6);
  });

  it('uses font metrics provider for baseline without changing multiple line height', () => {
    const paragraph: RenderParagraph = {
      lineSpacing: { kind: 'multiple', value: 1 },
      runs: [{
        text: 'Metrics baseline',
        fontSize: 12,
      }],
    };

    const metrics = measureLineMetrics(paragraph, {
      width: 1,
      slices: [{
        paragraphIndex: 0,
        runIndex: 0,
        text: 'Metrics baseline',
        x: 0,
        width: 1,
      }],
    }, 1, 0, metricsProvider, (run) => ({
      fontFamily: run.fontFamily ?? 'Metrics',
      fontSizePt: run.fontSize ?? 12,
      bold: false,
      italic: false,
    }));

    expect(metrics.height).toBeCloseTo((12 * SINGLE_SPACING_LINE_HEIGHT_EM) / 72, 6);
    // 行高高出字形框的部分上下平分，baseline 只随它下移，不改行高。
    expect(metrics.baseline).toBeCloseTo(0.14 + (metrics.height - 0.14 - 0.04) / 2, 6);
  });

  it('keeps glyph metrics intact when exact point spacing is smaller than the glyph box', () => {
    const paragraph: RenderParagraph = {
      lineSpacing: { kind: 'exactPt', value: 11.52 },
      runs: [{
        text: 'Compressed spacing',
        fontSize: 12,
      }],
    };

    const metrics = measureLineMetrics(paragraph, {
      width: 1,
      slices: [{
        paragraphIndex: 0,
        runIndex: 0,
        text: 'Compressed spacing',
        x: 0,
        width: 1,
      }],
    }, 1, 0, metricsProvider, (run) => ({
      fontFamily: run.fontFamily ?? 'Metrics',
      fontSizePt: run.fontSize ?? 12,
      bold: false,
      italic: false,
    }));

    expect(metrics.height).toBeCloseTo(0.16, 6);
    expect(metrics.baseline).toBeCloseTo(0.14, 6);
  });
});
