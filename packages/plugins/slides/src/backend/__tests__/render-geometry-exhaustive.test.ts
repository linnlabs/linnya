import { describe, expect, it } from 'vitest';
import type {
  DeckSpec,
  RenderParagraph,
  StructuredElement,
  TextLayoutResult,
  TextRenderNode,
} from '@plugin/slides/shared';
import {
  buildCartesianRange,
  buildChartFrame,
} from '@plugin/slides/shared';
import { applyTextLayoutToRenderModel } from '../engine/text/renderModelTextLayout.js';
import { RenderModelMapper } from '../engine/parser/RenderModelMapper.js';
import { buildGeneratedTextRenderNode } from '../engine/parser/render-model/RenderModelText.js';

const mapper = new RenderModelMapper();
const SLIDE_SIZE = { width: 10, height: 5.625 };
const FLOAT_EPSILON = 0.000001;

function renderSlide(elements: StructuredElement[], theme?: DeckSpec['theme']) {
  const deckSpec: DeckSpec = {
    title: 'Geometry Exhaustive Test',
    theme,
    slides: [{
      slideNumber: 1,
      spec: {
        type: 'structured',
        elements,
      },
    }],
  };
  const renderModel = mapper.fromGeneratedDeck('geom-test', 1, deckSpec.title, deckSpec, SLIDE_SIZE);
  return applyTextLayoutToRenderModel(renderModel).slides[0]!;
}

function getTextNode(elements: StructuredElement[]): TextRenderNode {
  const node = renderSlide(elements).elements.find((entry) => entry.kind === 'text');
  if (node == null || node.kind !== 'text') {
    throw new Error('未找到文本节点');
  }
  return node;
}

function getChartNode(elements: StructuredElement[]) {
  const node = renderSlide(elements).elements.find((entry) => entry.kind === 'chart');
  if (node == null || node.kind !== 'chart') {
    throw new Error('未找到图表节点');
  }
  return node;
}

function requireTextLayout(node: TextRenderNode): TextLayoutResult {
  if (node.layout == null) {
    throw new Error(`文本节点 ${node.id} 缺少后端行级 layout`);
  }
  return node.layout;
}

function usableContentHeight(node: TextRenderNode): number {
  return Math.max(
    node.box.h - (node.padding?.top ?? 0) - (node.padding?.bottom ?? 0),
    0,
  );
}

function linePlainText(layout: TextLayoutResult): string {
  return layout.lines
    .flatMap((line) => line.slices)
    .filter((slice) => slice.isBulletMarker !== true)
    .map((slice) => slice.text)
    .join('');
}

describe('render geometry exhaustive', () => {
  describe('文本几何快照', () => {
    it('高密度标题在 resize-shape 下 box 扩展、字号不缩', () => {
      const node = getTextNode([{
        type: 'title',
        content: 'Global BEV sales increased ~1000% in 2020 (over 20 Mn vehicles sold); High sales Europe on the back of stricter emission norms',
        position: { x: 0.4, y: 0.32, w: 8.6, h: 0.52 },
        style: { fontSize: 14, bold: true, fontFamily: 'Georgia', lineSpacing: { kind: 'exactPt', value: 18 } },
      }]);

      const layout = requireTextLayout(node);

      expect(layout.lines.length).toBeGreaterThan(1);
      expect(linePlainText(layout)).toBe(node.paragraphs[0]!.runs[0]!.text);
      // resize-shape 策略下 box 已扩展，字号保持不变。
      expect(layout.appliedFontScale).toBe(1);
      expect(layout.requiredHeightInches).toBeLessThanOrEqual(node.box.h + FLOAT_EPSILON);
      expect(layout.contentHeightInches).toBeLessThanOrEqual(usableContentHeight(node) + FLOAT_EPSILON);
    });

    it('高密度 bullet 文本在 resize-shape 下 box 扩展、字号不缩', () => {
      const node = getTextNode([{
        type: 'bulletList',
        items: [
          { text: 'Electric vehicles comprised 4.6% of overall vehicle sales in 2020' },
          { text: '90% decline in battery prices between 2010 and 2020 (owing to affordability)' },
          { text: 'Stricter environmental regulations helping push for sustainability' },
        ],
        position: { x: 0.4, y: 3.72, w: 2.45, h: 1.2 },
        style: { fontSize: 7, color: '#333333', fontFamily: 'Arial', lineSpacing: { kind: 'exactPt', value: 10 }, valign: 'top' },
      }]);

      const layout = requireTextLayout(node);

      expect(layout.lines.length).toBeGreaterThan(3);
      expect(layout.lines.some((line) => line.slices.some((slice) => slice.isBulletMarker === true))).toBe(true);
      // resize-shape 策略下字号保持不变，box 已按内容高度扩展。
      expect(layout.appliedFontScale).toBe(1);
      expect(layout.requiredHeightInches).toBeLessThanOrEqual(node.box.h + FLOAT_EPSILON);
      expect(layout.contentHeightInches).toBeLessThanOrEqual(usableContentHeight(node) + FLOAT_EPSILON);
    });

    it('resize-shape 模式下 box 高度自动扩展以容纳文本', () => {
      const node = getTextNode([{
        type: 'text',
        content: 'A very long text that should expand the box instead of shrinking inside the original box.',
        position: { x: 1, y: 1, w: 2, h: 0.3 },
        style: { fontSize: 14, lineSpacing: { kind: 'exactPt', value: 18 } },
      }]);

      expect(node.autoFitPolicy).toBe('resize-shape');
      // finalization 扩展高度，不再保持 0.3
      expect(node.box.h).toBeGreaterThan(0.3);
    });

    it('mapper 不做第二次估高，非 shrink-text 也保留 source box', () => {
      const paragraphs: RenderParagraph[] = [{
        lineSpacing: { kind: 'exactPt', value: 18 },
        runs: [{
          text: 'This paragraph is intentionally long and is finalized after mapping.',
          fontFamily: 'Arial',
          fontSize: 14,
        }],
      }];

      const node = buildGeneratedTextRenderNode(
        {
          id: 'manual-text',
          kind: 'text',
          box: { x: 1, y: 1, w: 2, h: 0.3, unit: 'in' },
          zIndex: 0,
          visible: true,
          paragraphs,
        },
        paragraphs,
        'top',
      );

      expect(node.box.h).toBe(0.3);
    });
  });

  describe('图表几何快照', () => {
    it('bar 图的 category label 字号越大，left gutter 越大', () => {
      const smallFrame = buildChartFrame(320, 220, undefined, {
        chartType: 'bar',
        categoryAxisLabelFontSizePx: 8,
        xAxisVisible: false,
        yAxisVisible: true,
      });
      const largeFrame = buildChartFrame(320, 220, undefined, {
        chartType: 'bar',
        categoryAxisLabelFontSizePx: 16,
        xAxisVisible: false,
        yAxisVisible: true,
      });

      expect(largeFrame.leftGutter).toBeGreaterThan(smallFrame.leftGutter);
      expect(largeFrame.plotWidth).toBeLessThan(smallFrame.plotWidth);
    });

    it('bottom legend 会压缩 plotHeight，但不会小于最小安全高度', () => {
      const frame = buildChartFrame(768, 62.4, { visible: true, position: 'bottom' }, {
        chartType: 'bar',
        categoryAxisLabelFontSizePx: 9.333,
        xAxisVisible: false,
        yAxisVisible: true,
      });

      expect(frame.bottomGutter).toBeGreaterThan(20);
      expect(frame.plotHeight).toBe(32);
    });

    it('不同 legend 位置只影响对应 gutter', () => {
      const right = buildChartFrame(600, 320, { visible: true, position: 'right' });
      const top = buildChartFrame(600, 320, { visible: true, position: 'top' });
      const left = buildChartFrame(600, 320, { visible: true, position: 'left' });

      expect(right.rightGutter).toBeGreaterThan(120);
      expect(right.leftGutter).toBe(52);
      expect(top.topGutter).toBeGreaterThan(20);
      expect(top.rightGutter).toBe(20);
      expect(left.leftGutter).toBeGreaterThan(120);
      expect(left.rightGutter).toBe(20);
    });

    it('percent stacked 范围固定为 0-100', () => {
      const node = getChartNode([{
        type: 'chart',
        chartType: 'bar',
        position: { x: 1, y: 1, w: 8, h: 0.65 },
        data: {
          categories: ['Post-95'],
          series: [
            { name: 'A', labels: ['Post-95'], values: [19] },
            { name: 'B', labels: ['Post-95'], values: [27] },
            { name: 'C', labels: ['Post-95'], values: [54] },
          ],
        },
        options: { barDir: 'bar', barGrouping: 'percentStacked' },
      }]);

      expect(buildCartesianRange(node)).toEqual({ min: 0, max: 100 });
    });

    it('普通 stacked 会按类目求和，且支持负值', () => {
      const node = getChartNode([{
        type: 'chart',
        chartType: 'bar',
        position: { x: 1, y: 1, w: 5, h: 2 },
        data: {
          categories: ['Q1', 'Q2'],
          series: [
            { name: 'A', labels: ['Q1', 'Q2'], values: [10, -5] },
            { name: 'B', labels: ['Q1', 'Q2'], values: [20, -7] },
            { name: 'C', labels: ['Q1', 'Q2'], values: [-3, 8] },
          ],
        },
        options: { barDir: 'bar', barGrouping: 'stacked' },
      }]);

      expect(buildCartesianRange(node)).toEqual({ min: -12, max: 30 });
    });

    it('column 图的 y 轴 override 会进入最终范围', () => {
      const node = getChartNode([{
        type: 'chart',
        chartType: 'line',
        position: { x: 1, y: 1, w: 5, h: 2 },
        data: {
          categories: ['Q1', 'Q2'],
          series: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [10, 20] }],
        },
        options: { valAxisMinVal: -10, valAxisMaxVal: 50 },
      }]);

      expect(buildCartesianRange(node)).toEqual({ min: -10, max: 50 });
    });

    it('bar 图的 value 轴 override 也必须进入最终范围', () => {
      const node = getChartNode([{
        type: 'chart',
        chartType: 'bar',
        position: { x: 1, y: 1, w: 5, h: 2 },
        data: {
          categories: ['Tesla', 'BYD'],
          series: [{ name: '销量', labels: ['Tesla', 'BYD'], values: [500, 132] }],
        },
        options: { barDir: 'bar', valAxisMinVal: 0, valAxisMaxVal: 600 },
      }]);

      expect(buildCartesianRange(node)).toEqual({ min: 0, max: 600 });
    });
  });
});
