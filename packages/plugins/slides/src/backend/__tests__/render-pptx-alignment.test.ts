/**
 * 元素级 Konva-PPTX 对齐测试 (Layer 3)
 *
 * 同一份 DeckSpec 同时走 RenderModelMapper 和 StructuredCompiler，比较结构化字段差异。
 */

import { describe, expect, it } from 'vitest';
import type { StructuredElement } from '@plugin/slides/shared';
import {
  THEME,
  TINY_PNG_DATA_URI,
  diffElements,
  makeBulletList,
  makeChart,
  makeImage,
  makeShape,
  makeTable,
  makeText,
  makeTitle,
  printReport,
  runDualPipeline,
  type NormalizedElement,
} from './helpers/render-pptx-alignment-harness.js';

describe('Konva-PPTX 元素级对齐', () => {
  describe('文本元素对齐', () => {
    it('title 几何对齐', () => {
      const result = runDualPipeline([
        makeTitle('战略规划报告', { x: 0.5, y: 0.3, w: 9, h: 0.8 }),
      ], THEME);
      printReport(result, 'title 几何');

      expect(result.konva).toHaveLength(1);
      expect(result.pptx).toHaveLength(1);

      const geoErrors = result.diffs.filter(
        (d) => d.category === 'GEOMETRY' && d.severity === 'error',
      );
      expect(geoErrors).toHaveLength(0);
    });

    it('text 带 lineSpacing 两侧一致', () => {
      const result = runDualPipeline([
        makeText('高密度内容文本', { x: 0.5, y: 1.5, w: 4, h: 1 }, {
          fontSize: 12,
          fontFamily: 'Calibri',
          lineSpacing: { kind: 'exactPt', value: 18 },
        }),
      ], THEME);
      printReport(result, 'text lineSpacing');

      // RenderModel 与 PPTX 都归一成 point-based lineSpacing 后再比较。
      const lsDiff = result.diffs.find((d) => d.field === 'text.lineSpacingPt');
      if (lsDiff) {
        expect(lsDiff.severity).not.toBe('error');
      }
    });

    it('bulletList 元素数量与几何一致', () => {
      const result = runDualPipeline([
        makeBulletList(
          [
            { text: '第一项', level: 0 },
            { text: '第二项', level: 1 },
            { text: '第三项', level: 0 },
          ],
          { x: 0.5, y: 1.5, w: 4, h: 2 },
          { fontSize: 11 },
        ),
      ], THEME);
      printReport(result, 'bulletList');

      expect(result.konva).toHaveLength(1);
      expect(result.pptx).toHaveLength(1);

      const geoErrors = result.diffs.filter(
        (d) => d.category === 'GEOMETRY' && d.severity === 'error',
      );
      expect(geoErrors).toHaveLength(0);
    });
  });

  describe('图表元素对齐', () => {
    it('column 图表 几何+配置', () => {
      const result = runDualPipeline([
        makeChart('bar', { x: 0.5, y: 1.5, w: 4.5, h: 3 }, {
          showLegend: true,
          showValue: true,
          dataLabelPosition: 'outEnd',
          dataLabelFontSize: 8,
          catAxisLabelFontSize: 9,
          valAxisLabelFontSize: 7,
          legendPos: 'b',
          legendFontSize: 6.5,
          barGrouping: 'stacked',
        }),
      ], THEME);
      printReport(result, 'column chart');

      expect(result.konva).toHaveLength(1);
      expect(result.pptx).toHaveLength(1);

      const chartErrors = result.diffs.filter(
        (d) => d.category === 'CHART_CONFIG' && d.severity === 'error',
      );
      expect(chartErrors).toHaveLength(0);

      const geoErrors = result.diffs.filter(
        (d) => d.category === 'GEOMETRY' && d.severity === 'error',
      );
      expect(geoErrors).toHaveLength(0);
    });

    it('bar(横向) 图表 轴映射正确', () => {
      const result = runDualPipeline([
        makeChart('bar', { x: 0.5, y: 1.5, w: 4.5, h: 3 }, {
          barDir: 'bar',
          catAxisLabelFontSize: 9,
          valAxisLabelFontSize: 7,
          valAxisHidden: true,
          valAxisMaxVal: 500,
        }),
      ], THEME);
      printReport(result, 'bar chart');

      const chartTypeDiff = result.diffs.find((d) => d.field === 'chart.chartType');
      expect(chartTypeDiff).toBeUndefined();

      const valHiddenDiff = result.diffs.find((d) => d.field === 'chart.valAxisHidden');
      if (valHiddenDiff) {
        expect(valHiddenDiff.konvaValue).toBe(valHiddenDiff.pptxValue);
      }
    });

    it('line 图表 对齐', () => {
      const result = runDualPipeline([
        makeChart('line', { x: 5.2, y: 1.5, w: 4.5, h: 3 }, {
          showLegend: true,
          legendPos: 'b',
          legendFontSize: 6,
          catAxisLabelFontSize: 8,
          valAxisLabelFontSize: 7,
          showValue: true,
          dataLabelPosition: 'outEnd',
          dataLabelFontSize: 7,
        }),
      ], THEME);
      printReport(result, 'line chart');

      const chartErrors = result.diffs.filter(
        (d) => d.category === 'CHART_CONFIG' && d.severity === 'error',
      );
      expect(chartErrors).toHaveLength(0);
    });
  });

  describe('表格元素对齐', () => {
    it('table 几何+列宽+行高', () => {
      const result = runDualPipeline([
        makeTable(
          ['指标', 'Q1', 'Q2', 'Q3'],
          [
            [{ text: '收入' }, { text: '100M' }, { text: '150M' }, { text: '200M' }],
            [{ text: '利润' }, { text: '30M' }, { text: '45M' }, { text: '60M' }],
          ],
          { x: 0.5, y: 2, w: 9, h: 2.5 },
        ),
      ], THEME);
      printReport(result, 'table');

      expect(result.konva).toHaveLength(1);
      expect(result.pptx).toHaveLength(1);

      const geoErrors = result.diffs.filter(
        (d) => d.category === 'GEOMETRY' && d.severity === 'error',
      );
      expect(geoErrors).toHaveLength(0);
    });
  });

  describe('形状元素对齐', () => {
    it('rect shape 几何+样式', () => {
      const result = runDualPipeline([
        makeShape('rect', { x: 1, y: 1, w: 3, h: 2 }, {
          fill: '#3366CC',
          border: { color: '#000000', width: 2 },
          borderRadius: 0.1,
        }),
      ], THEME);
      printReport(result, 'rect shape');

      expect(result.konva).toHaveLength(1);
      expect(result.pptx).toHaveLength(1);

      const geoErrors = result.diffs.filter(
        (d) => d.category === 'GEOMETRY' && d.severity === 'error',
      );
      expect(geoErrors).toHaveLength(0);
    });

    it('shape 带文本 addText(shape=...) 对齐', () => {
      const result = runDualPipeline([
        makeShape('roundRect', { x: 1, y: 1, w: 3, h: 1.5 }, {
          fill: '#E8E8E8',
        }, '重要说明'),
      ], THEME);
      printReport(result, 'shape with text');

      expect(result.konva).toHaveLength(1);
      expect(result.pptx).toHaveLength(1);

      const geoErrors = result.diffs.filter(
        (d) => d.category === 'GEOMETRY' && d.severity === 'error',
      );
      expect(geoErrors).toHaveLength(0);
    });
  });

  describe('图片元素对齐', () => {
    it('image 几何对齐', () => {
      const result = runDualPipeline([
        makeImage(TINY_PNG_DATA_URI, { x: 5, y: 1, w: 4, h: 3 }, '示例图片'),
      ], THEME);
      printReport(result, 'image');

      expect(result.konva).toHaveLength(1);
      expect(result.pptx).toHaveLength(1);

      const geoErrors = result.diffs.filter(
        (d) => d.category === 'GEOMETRY' && d.severity === 'error',
      );
      expect(geoErrors).toHaveLength(0);
    });
  });

  describe('全要素混合页对齐', () => {
    it('包含 title+text+chart+table+shape+image 的完整页面', () => {
      const elements: StructuredElement[] = [
        makeTitle('2025 年度业绩报告', { x: 0.5, y: 0.2, w: 9, h: 0.7 }, {
          fontSize: 28,
          bold: true,
          color: '#1A1A2E',
        }),
        makeText('以下为各季度财务数据摘要', { x: 0.5, y: 1.0, w: 9, h: 0.4 }, {
          fontSize: 12,
          color: '#666666',
          lineSpacing: { kind: 'exactPt', value: 18 },
        }),
        makeChart('bar', { x: 0.5, y: 1.6, w: 4.2, h: 2.5 }, {
          showLegend: true,
          showValue: true,
          dataLabelPosition: 'outEnd',
          dataLabelFontSize: 7,
          catAxisLabelFontSize: 8,
          valAxisLabelFontSize: 7,
          legendPos: 'b',
          legendFontSize: 6,
        }),
        makeTable(
          ['季度', '收入', '利润', '增长率'],
          [
            [{ text: 'Q1' }, { text: '100M' }, { text: '30M' }, { text: '+15%' }],
            [{ text: 'Q2' }, { text: '150M' }, { text: '45M' }, { text: '+50%' }],
          ],
          { x: 5.0, y: 1.6, w: 4.5, h: 1.8 },
        ),
        makeShape('rect', { x: 5.0, y: 3.6, w: 4.5, h: 0.8 }, {
          fill: '#F0F4FF',
          borderRadius: 0.08,
        }, '关键洞察：Q2 利润率大幅提升'),
        makeImage(TINY_PNG_DATA_URI, { x: 0.5, y: 4.3, w: 2, h: 1 }),
      ];

      const result = runDualPipeline(elements, THEME);
      printReport(result, '全要素混合页');

      expect(result.konva.length).toBe(result.pptx.length);

      const errors = result.diffs.filter(
        (d) => d.severity === 'error' && !d.whitelisted,
      );

      // 严格：不允许 error 级差异
      expect(errors).toHaveLength(0);
    });
  });

  describe('diff 引擎正确性', () => {
    it('完全一致的元素不产生 diff', () => {
      const el: NormalizedElement = {
        index: 0,
        type: 'text',
        geometry: { x: 1, y: 1, w: 4, h: 2 },
        text: { fontSize: 12, fontFamily: 'Arial', bold: true },
      };
      const diffs = diffElements([el], [{ ...el }]);
      expect(diffs).toHaveLength(0);
    });

    it('几何微小差异为 info', () => {
      const base: NormalizedElement = {
        index: 0,
        type: 'text',
        geometry: { x: 1, y: 1, w: 4, h: 2 },
      };
      const shifted: NormalizedElement = {
        ...base,
        geometry: { x: 1.005, y: 1, w: 4, h: 2 },
      };
      const diffs = diffElements([base], [shifted]);
      const geoDiff = diffs.find((d) => d.field === 'geometry.x');
      expect(geoDiff?.severity).toBe('info');
    });

    it('几何大差异为 error', () => {
      const base: NormalizedElement = {
        index: 0,
        type: 'text',
        geometry: { x: 1, y: 1, w: 4, h: 2 },
      };
      const shifted: NormalizedElement = {
        ...base,
        geometry: { x: 1.1, y: 1, w: 4, h: 2 },
      };
      const diffs = diffElements([base], [shifted]);
      const geoDiff = diffs.find((d) => d.field === 'geometry.x');
      expect(geoDiff?.severity).toBe('error');
    });

    it('白名单命中时 severity 降为 info', () => {
      const konva: NormalizedElement = {
        index: 0,
        type: 'text',
        geometry: { x: 1, y: 1, w: 4, h: 2 },
        text: { bold: undefined },
      };
      const pptx: NormalizedElement = {
        index: 0,
        type: 'text',
        geometry: { x: 1, y: 1, w: 4, h: 2 },
        text: { bold: true },
      };
      const diffs = diffElements([konva], [pptx]);
      const boldDiff = diffs.find((d) => d.field === 'text.bold');
      expect(boldDiff?.severity).toBe('info');
      expect(boldDiff?.whitelisted).toBeTruthy();
    });
  });
});
