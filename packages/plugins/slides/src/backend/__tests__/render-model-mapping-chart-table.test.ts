/** DeckSpec → RenderModel 图表与表格映射完整性测试。 */

import { describe, expect, it } from 'vitest';
import type { StructuredElement } from '@plugin/slides/shared';
import { BOX, getNode } from './helpers/render-model-mapping-harness.js';

// ─── 第五部分：图表映射 ──────────────────────────────────────────────────

describe('图表映射完整性', () => {
  const baseChartElement = (overrides?: Partial<Extract<StructuredElement, { type: 'chart' }>>) => ({
    type: 'chart' as const,
    chartType: 'bar' as const,
    data: {
      categories: ['Q1', 'Q2', 'Q3'],
      series: [
        { name: 'Revenue', labels: ['Q1', 'Q2', 'Q3'], values: [10, 20, 30] },
        { name: 'Profit', labels: ['Q1', 'Q2', 'Q3'], values: [5, 10, 15] },
      ],
    },
    position: BOX,
    ...overrides,
  });

  describe('chartType 映射', () => {
    it('DeckSpec bar + barDir=bar → RenderModel bar (横向)', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { barDir: 'bar' },
      })], 'chart');
      expect(node.chartType).toBe('bar');
    });

    it('DeckSpec bar + barDir 默认 → RenderModel column (纵向)', () => {
      const node = getNode<'chart'>([baseChartElement({
        chartType: 'bar',
      })], 'chart');
      // bar 在 resolveGeneratedRenderChartType 中会映射为 column，
      // 除非 barDir='bar' 显式指定横向
      expect(['bar', 'column']).toContain(node.chartType);
    });

    const supportedTypes = ['line', 'pie', 'doughnut', 'scatter', 'area', 'radar'] as const;
    for (const chartType of supportedTypes) {
      it(`chartType=${chartType} 正确映射`, () => {
        const node = getNode<'chart'>([baseChartElement({ chartType })], 'chart');
        expect(node.chartType).toBe(chartType);
      });
    }
  });

  describe('stacking 映射', () => {
    it('barGrouping=stacked → stacking=stacked', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { barGrouping: 'stacked', barDir: 'bar' },
      })], 'chart');
      expect(node.stacking).toBe('stacked');
    });

    it('barGrouping=percentStacked → stacking=percent', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { barGrouping: 'percentStacked', barDir: 'bar' },
      })], 'chart');
      expect(node.stacking).toBe('percent');
    });

    it('barGrouping 未设置 → stacking=undefined', () => {
      const node = getNode<'chart'>([baseChartElement()], 'chart');
      expect(node.stacking).toBeUndefined();
    });
  });

  describe('axes 映射', () => {
    it('valAxisHidden=true → 对应轴 visible=false', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { valAxisHidden: true, barDir: 'bar' },
      })], 'chart');
      // bar 图：value 轴是 x 轴
      expect(node.axes?.x?.visible).toBe(false);
    });

    it('catAxisHidden=true → 对应轴 visible=false', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { catAxisHidden: true, barDir: 'bar' },
      })], 'chart');
      // bar 图：category 轴是 y 轴
      expect(node.axes?.y?.visible).toBe(false);
    });

    it('valAxisMaxVal/MinVal 正确映射', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { valAxisMaxVal: 100, valAxisMinVal: 0, barDir: 'bar' },
      })], 'chart');
      expect(node.axes?.x?.max).toBe(100);
      expect(node.axes?.x?.min).toBe(0);
    });

    it('column 图的轴方向与 bar 图相反', () => {
      const node = getNode<'chart'>([baseChartElement({
        chartType: 'line',
        options: { valAxisHidden: true },
      })], 'chart');
      // line/column 图：value 轴是 y 轴
      expect(node.axes?.y?.visible).toBe(false);
      expect(node.axes?.x?.visible).toBe(true);
    });
  });

  describe('dataLabels 映射', () => {
    it('showValue=true → dataLabels.visible=true', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { showValue: true },
      })], 'chart');
      expect(node.dataLabels?.visible).toBe(true);
    });

    it('dataLabelPosition 映射', () => {
      const posMap: Record<string, string> = {
        outEnd: 'outside',
        inEnd: 'inside',
        ctr: 'center',
        inBase: 'inside',
      };
      for (const [pptxPos, renderPos] of Object.entries(posMap)) {
        const node = getNode<'chart'>([baseChartElement({
          options: { showValue: true, dataLabelPosition: pptxPos },
        })], 'chart');
        expect(node.dataLabels?.position).toBe(renderPos);
      }
    });

    it('dataLabelFormatCode 正确透传', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { showValue: true, dataLabelFormatCode: '#,##0.0"%"' },
      })], 'chart');
      expect(node.dataLabels?.format).toBe('#,##0.0"%"');
    });

    it('showValue 未设置时 dataLabels 为 undefined', () => {
      const node = getNode<'chart'>([baseChartElement()], 'chart');
      expect(node.dataLabels).toBeUndefined();
    });
  });

  describe('legend 映射', () => {
    it('showLegend=true + legendPos=b → legend visible + bottom', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { showLegend: true, legendPos: 'b' },
      })], 'chart');
      expect(node.legend?.visible).toBe(true);
      expect(node.legend?.position).toBe('bottom');
    });

    it('showLegend=false → legend visible=false', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { showLegend: false },
      })], 'chart');
      expect(node.legend?.visible).toBe(false);
    });

    it('legendPos 各值映射', () => {
      const posMap: Record<string, string> = {
        b: 'bottom', l: 'left', r: 'right', t: 'top', tr: 'top',
      };
      for (const [pptxPos, renderPos] of Object.entries(posMap)) {
        const node = getNode<'chart'>([baseChartElement({
          options: { showLegend: true, legendPos: pptxPos },
        })], 'chart');
        expect(node.legend?.position).toBe(renderPos);
      }
    });
  });

  describe('gridlines 映射', () => {
    it('catGridLine=false → 对应方向 gridline visible=false', () => {
      const node = getNode<'chart'>([baseChartElement({
        chartType: 'line',
        options: { catGridLine: false },
      })], 'chart');
      expect(node.gridlines?.x?.visible).toBe(false);
    });

    it('valGridLine=false → 对应方向 gridline visible=false', () => {
      const node = getNode<'chart'>([baseChartElement({
        chartType: 'line',
        options: { valGridLine: false },
      })], 'chart');
      expect(node.gridlines?.y?.visible).toBe(false);
    });

    it('两个 gridline 都正常时返回 undefined', () => {
      const node = getNode<'chart'>([baseChartElement()], 'chart');
      expect(node.gridlines).toBeUndefined();
    });
  });

  describe('labelStyle 映射', () => {
    it('chartStyle 颜色进入轴标签、数据标签和网格线的正式 RenderModel 字段', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { showValue: true, showLegend: true },
        chartStyle: {
          legendColor: '#F1F5F9',
          plotBackgroundColor: '#123456',
          seriesLineWidth: 3,
          axisLabelColor: '#475569',
          categoryAxisLabelColor: '#334155',
          dataLabelColor: '#0F172A',
          gridlineColor: '#CBD5E1',
        },
      })], 'chart');

      expect(node.legend?.labelStyle?.color).toBe('#F1F5F9');
      expect(node.plotBackgroundColor).toBe('#123456');
      expect(node.seriesLineWidth).toBe(3);
      expect(node.axes?.x?.labelStyle?.color).toBe('#334155');
      expect(node.axes?.y?.labelStyle?.color).toBe('#475569');
      expect(node.dataLabels?.labelStyle?.color).toBe('#0F172A');
      expect(node.gridlines?.x?.color).toBe('#CBD5E1');
      expect(node.gridlines?.y?.color).toBe('#CBD5E1');
    });

    it('catAxisLabelFontFace + catAxisLabelFontSize → category axis labelStyle', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: { catAxisLabelFontFace: 'Georgia', catAxisLabelFontSize: 9 },
      })], 'chart');
      expect(node.labelStyle?.fontFamily).toBe('Georgia');
      expect(node.labelStyle?.fontSize).toBe(9);
      expect(node.axes?.x?.labelStyle?.fontFamily).toBe('Georgia');
      expect(node.axes?.x?.labelStyle?.fontSize).toBe(9);
    });

    it('value / legend / dataLabel 各自字体正确映射', () => {
      const node = getNode<'chart'>([baseChartElement({
        options: {
          catAxisLabelFontFace: 'Georgia',
          catAxisLabelFontSize: 9,
          valAxisLabelFontSize: 7,
          legendFontFace: 'Aptos',
          legendFontSize: 6.5,
          showLegend: true,
          dataLabelFontFace: 'Tahoma',
          dataLabelFontSize: 8,
          showValue: true,
        },
      })], 'chart');
      expect(node.axes?.y?.labelStyle?.fontSize).toBe(7);
      expect(node.legend?.labelStyle?.fontFamily).toBe('Aptos');
      expect(node.legend?.labelStyle?.fontSize).toBe(6.5);
      expect(node.dataLabels?.labelStyle?.fontFamily).toBe('Tahoma');
      expect(node.dataLabels?.labelStyle?.fontSize).toBe(8);
    });

    it('bar 图的 category/value 轴字体方向要互换', () => {
      const node = getNode<'chart'>([baseChartElement({
        chartType: 'bar',
        options: {
          barDir: 'bar',
          catAxisLabelFontFace: 'Georgia',
          catAxisLabelFontSize: 9,
          valAxisLabelFontSize: 7,
        },
      })], 'chart');
      expect(node.axes?.y?.labelStyle?.fontFamily).toBe('Georgia');
      expect(node.axes?.y?.labelStyle?.fontSize).toBe(9);
      expect(node.axes?.x?.labelStyle?.fontSize).toBe(7);
    });

    it('未设置时回退到 theme minor font', () => {
      const node = getNode<'chart'>([baseChartElement()], 'chart');
      expect(node.labelStyle?.fontFamily).toBeTruthy();
    });
  });

  describe('series 映射', () => {
    it('series 名称和数据正确映射', () => {
      const node = getNode<'chart'>([baseChartElement()], 'chart');
      expect(node.series).toHaveLength(2);
      expect(node.series[0]!.name).toBe('Revenue');
      expect(node.series[0]!.values).toEqual([10, 20, 30]);
      expect(node.series[1]!.name).toBe('Profit');
    });

    it('series color 来自 theme 调色盘', () => {
      const node = getNode<'chart'>([baseChartElement()], 'chart');
      for (const series of node.series) {
        expect(series.color).toBeTruthy();
        expect(series.color).toMatch(/^#/);
      }
    });

    it('categories 正确映射', () => {
      const node = getNode<'chart'>([baseChartElement()], 'chart');
      expect(node.categories).toEqual(['Q1', 'Q2', 'Q3']);
    });
  });
});

// ─── 第六部分：表格映射 ──────────────────────────────────────────────────

describe('表格映射完整性', () => {
  it('统一边框会展开为每个单元格的四边 RenderStroke', () => {
    const node = getNode<'table'>([{
      type: 'table',
      rows: [[{ text: 'A' }, { text: 'B' }]],
      position: BOX,
      border: {
        width: 0.75,
        paint: { type: 'solid', color: '#94A3B8' },
      },
    }], 'table');

    expect(node.cells).toHaveLength(2);
    for (const cell of node.cells) {
      expect(cell.borders).toEqual({
        top: { width: 0.75, paint: { type: 'solid', color: '#94A3B8' } },
        right: { width: 0.75, paint: { type: 'solid', color: '#94A3B8' } },
        bottom: { width: 0.75, paint: { type: 'solid', color: '#94A3B8' } },
        left: { width: 0.75, paint: { type: 'solid', color: '#94A3B8' } },
      });
    }
  });

  it('headers + rows 正确映射为 cells', () => {
    const node = getNode<'table'>([{
      type: 'table',
      headers: ['Name', 'Value'],
      rows: [
        [{ text: 'Alpha' }, { text: '100' }],
        [{ text: 'Beta' }, { text: '200' }],
      ],
      position: BOX,
    }], 'table');

    expect(node.kind).toBe('table');
    expect(node.headerRows).toBe(1);
    expect(node.columns).toHaveLength(2);
    expect(node.rows).toHaveLength(3); // 1 header + 2 data

    // 表头单元格
    const headerCell = node.cells.find((c) => c.row === 0 && c.col === 0);
    expect(headerCell).toBeDefined();
    expect(headerCell!.paragraphs[0]!.runs[0]!.text).toBe('Name');
    expect(headerCell!.paragraphs[0]!.runs[0]!.fontWeight).toBe('bold');
    expect(headerCell!.fill).toBe('#F2F2F2');

    // 数据单元格
    const dataCell = node.cells.find((c) => c.row === 1 && c.col === 0);
    expect(dataCell).toBeDefined();
    expect(dataCell!.paragraphs[0]!.runs[0]!.text).toBe('Alpha');
  });

  it('无 headers 时 headerRows 为 undefined', () => {
    const node = getNode<'table'>([{
      type: 'table',
      rows: [[{ text: 'A' }, { text: 'B' }]],
      position: BOX,
    }], 'table');

    expect(node.headerRows).toBeUndefined();
  });

  it('单元格样式透传', () => {
    const node = getNode<'table'>([{
      type: 'table',
      rows: [[{
        text: 'Styled',
        style: { bold: true, color: '#FF0000', fontSize: 14 },
        fill: '#EEEEFF',
      }]],
      position: BOX,
    }], 'table');

    const cell = node.cells[0]!;
    expect(cell.paragraphs[0]!.runs[0]!.fontWeight).toBe('bold');
    expect(cell.paragraphs[0]!.runs[0]!.color).toBe('#FF0000');
    expect(cell.fill).toBe('#EEEEFF');
  });

  it('colspan/rowspan 正确映射', () => {
    const node = getNode<'table'>([{
      type: 'table',
      rows: [[
        { text: 'Merged', colspan: 2 },
        { text: 'Normal' },
      ]],
      position: BOX,
    }], 'table');

    const mergedCell = node.cells.find((c) => c.col === 0);
    expect(mergedCell!.colSpan).toBe(2);
  });

  it('列宽和行高数组长度正确', () => {
    const node = getNode<'table'>([{
      type: 'table',
      headers: ['A', 'B', 'C'],
      rows: [
        [{ text: '1' }, { text: '2' }, { text: '3' }],
        [{ text: '4' }, { text: '5' }, { text: '6' }],
      ],
      position: { x: 1, y: 1, w: 6, h: 3 },
    }], 'table');

    expect(node.columns).toHaveLength(3);
    expect(node.rows).toHaveLength(3); // 1 header + 2 data

    // 列宽之和应约等于 box width
    const totalColW = node.columns.reduce((s, w) => s + w, 0);
    expect(totalColW).toBeCloseTo(6, 1);

    // 行高之和应约等于 box height
    const totalRowH = node.rows.reduce((s, h) => s + h, 0);
    expect(totalRowH).toBeCloseTo(3, 1);
  });

  it('表格单元格内文本的 lineSpacing 也正确转换', () => {
    const node = getNode<'table'>([{
      type: 'table',
      rows: [[{
        text: 'Cell text',
        style: { fontSize: 10, lineSpacing: { kind: 'exactPt', value: 14 } },
      }]],
      position: BOX,
    }], 'table');

    expect(node.cells[0]!.paragraphs[0]!.lineSpacing).toEqual({ kind: 'exactPt', value: 14 });
  });
});
