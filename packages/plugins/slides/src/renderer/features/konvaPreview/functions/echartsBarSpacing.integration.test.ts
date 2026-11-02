import { init, use } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { describe, expect, it } from 'vitest';
import type { ChartRenderNode } from '../../../types/render';
import { mapChartNodeToEChartsOption } from './echartsMapper';

use([BarChart, LineChart, GridComponent, LegendComponent, SVGRenderer]);

describe('原生柱图间距的实际 ECharts 几何', () => {
  it('组合图主次轴分别形成柱簇，不把另一轴的柱数计入当前柱宽', () => {
    const node: ChartRenderNode = {
      id: 'dual-axis-bars', kind: 'chart', zIndex: 0,
      box: { x: 0, y: 0, w: 8, h: 5, unit: 'in' },
      chartType: 'combo', categories: ['A', 'B', 'C'], palette: ['#123456', '#654321', '#ABCDEF'],
      axes: { y: {}, y2: {} },
      series: [
        { name: 'Primary A', chartType: 'column', values: [10, 20, 30] },
        { name: 'Primary B', chartType: 'column', values: [15, 25, 35] },
        { name: 'Secondary', chartType: 'column', axis: 'secondary', values: [1, 2, 3] },
      ],
    };
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 768, height: 480 });
    try {
      chart.setOption(mapChartNodeToEChartsOption(node));
      const first = chart.convertToPixel({ xAxisIndex: 0 }, 0);
      const next = chart.convertToPixel({ xAxisIndex: 0 }, 1);
      if (typeof first !== 'number' || typeof next !== 'number') throw new Error('Expected category coordinates');
      const band = next - first;
      for (const [color, ratio] of [['#123456', 1 / 3.5], ['#654321', 1 / 3.5], ['#ABCDEF', 0.4]] as const) {
        const bars = chart.getZr().storage.getDisplayList(true).filter(item => item.style.fill === color);
        expect(bars).toHaveLength(3);
        for (const bar of bars) expect(bar.getBoundingRect().width / band).toBeCloseTo(ratio, 8);
      }
    } finally { chart.dispose(); }
  });

  it.each([
    { type: 'column', stacking: 'none', gap: 150, overlap: 0, count: 2, ratio: 1 / 3.5 },
    { type: 'bar', stacking: 'none', gap: 150, overlap: 0, count: 2, ratio: 1 / 3.5 },
    { type: 'column', stacking: 'none', gap: undefined, overlap: undefined, count: 2, ratio: 1 / 3.5 },
    { type: 'column', stacking: 'stacked', gap: 150, overlap: 100, count: 2, ratio: 0.4 },
    { type: 'column', stacking: 'percent', gap: 150, overlap: 100, count: 2, ratio: 0.4 },
    { type: 'column', stacking: 'stacked', gap: undefined, overlap: 100, count: 2, ratio: 1 / 1.5 },
    { type: 'combo', stacking: 'none', gap: 150, overlap: 0, count: 2, ratio: 1 / 3.5 },
    { type: 'combo', stacking: 'none', gap: 150, overlap: 0, count: 1, ratio: 0.4 },
    { type: 'column', stacking: 'none', gap: 150, overlap: 50, count: 2, ratio: 1 / 3 },
    { type: 'column', stacking: 'none', gap: 150, overlap: -50, count: 2, ratio: 0.25 },
    { type: 'column', stacking: 'none', gap: 0, overlap: 0, count: 2, ratio: 0.5 },
  ] as const)('$type / $stacking / gap=$gap / overlap=$overlap / bars=$count', ({ type, stacking, gap, overlap, count, ratio }) => {
    const node: ChartRenderNode = {
      id: 'spacing', kind: 'chart', zIndex: 0,
      box: { x: 0, y: 0, w: 8, h: 5, unit: 'in' },
      chartType: type, stacking,
      categories: ['A', 'B', 'C'], palette: ['#123456', '#654321', '#ABCDEF'],
      series: Array.from({ length: count }, (_, index) => ({ name: `Bar ${index}`, values: [10, 20, 30] })),
      pptxHints: { barGapWidthPct: gap, barOverlapPct: overlap },
    };
    if (type === 'combo') node.series.push({ name: 'Trend', chartType: 'line', values: [15, 25, 35] });
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 768, height: 480 });
    try {
      chart.setOption(mapChartNodeToEChartsOption(node));
      const axis = type === 'bar' ? { yAxisIndex: 0 } : { xAxisIndex: 0 };
      const first = chart.convertToPixel(axis, 0);
      const next = chart.convertToPixel(axis, 1);
      if (typeof first !== 'number' || typeof next !== 'number') throw new Error('Expected category coordinates');
      const band = Math.abs(next - first);
      const bars = chart.getZr().storage.getDisplayList(true)
        .filter(item => item.style.fill === '#123456')
        .map(item => item.getBoundingRect());
      expect(bars).toHaveLength(node.categories.length);
      for (const bar of bars) expect((type === 'bar' ? bar.height : bar.width) / band).toBeCloseTo(ratio, 8);
      if (stacking === 'none' && count === 2) {
        const other = chart.getZr().storage.getDisplayList(true).find(item => item.style.fill === '#654321')?.getBoundingRect();
        if (!other) throw new Error('Expected second series bar');
        const start = type === 'bar' ? bars[0].y : bars[0].x;
        const otherStart = type === 'bar' ? other.y : other.x;
        expect(Math.abs(otherStart - start) / (band * ratio)).toBeCloseTo(1 - (overlap ?? 0) / 100, 8);
      }
    } finally { chart.dispose(); }
  });
});
