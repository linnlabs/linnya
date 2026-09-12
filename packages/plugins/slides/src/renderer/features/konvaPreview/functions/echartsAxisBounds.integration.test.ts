import { describe, expect, it } from 'vitest';
import { init, use } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { ChartRenderNode } from '../../../types/render';
import { mapChartNodeToEChartsOption } from './echartsMapper';

use([BarChart, LineChart, GridComponent, LegendComponent, SVGRenderer]);

describe('ECharts 轴标题实际绘制边界', () => {
  it.each(['column', 'line', 'combo'] as const)('紧凑 %s 图的轴标题与刻度留在栅格画布内', (chartType) => {
    // 来自科研图表的真实风险：百分比留白随图高缩小，轴标题的字体和 nameGap 却不缩小。
    const title = '行内占比（归一化到 100%）';
    const secondaryTitle = '累计样本数';
    const node: ChartRenderNode = {
      id: 'compact-scientific-chart', kind: 'chart', zIndex: 1,
      box: { x: 0, y: 0, w: 8.9, h: 2.36, unit: 'in' },
      chartType,
      categories: ['分层1', '分层2', '分层3', '分层4'],
      palette: ['#1F5FA8', '#E07B39'],
      series: [
        { name: '类别A', values: [32, 40, 9, 55] },
        { name: '类别B', values: [21, 35, 18, 25], ...(chartType === 'combo' ? { chartType: 'line', axis: 'secondary' } as const : {}) },
      ],
      axes: {
        x: { title: '分层（每层是独立分母）', labelStyle: { fontSize: 8 } },
        y: { title, labelStyle: { fontSize: 8 } },
        ...(chartType === 'combo' ? { y2: { title: secondaryTitle, labelStyle: { fontSize: 8 } } } : {}),
      },
      legend: { visible: true, position: 'bottom', labelStyle: { fontSize: 8 } },
    };
    const width = node.box.w * 96;
    const height = node.box.h * 96;
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width, height });
    try {
      chart.setOption(mapChartNodeToEChartsOption(node));
      const titles = chartType === 'combo' ? [title, secondaryTitle] : [title];
      for (const expectedTitle of titles) {
        const spans = chart.getZr().storage.getDisplayList(true).filter(item => item.style.text === expectedTitle);
        expect(spans, `应实际绘制轴标题：${expectedTitle}`).toHaveLength(1);
        for (const span of spans) {
          const box = span.getBoundingRect().clone();
          const transform = span.getComputedTransform();
          if (transform) box.applyTransform(transform);
          expect(box.y, `轴标题上边界：${expectedTitle}`).toBeGreaterThanOrEqual(0);
          expect(box.x, `轴标题左边界：${expectedTitle}`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
          expect(box.y + box.height).toBeLessThanOrEqual(height);
        }
      }
      // 布局修复不得靠删轴名、缩短文字或丢弃数据来通过。
      const svg = chart.renderToSVGString();
      expect(svg).toContain(title);
      expect(svg).toContain('分层4');
      for (const [index, category] of node.categories.entries()) {
        const spans = chart.getZr().storage.getDisplayList(true).filter(item => item.style.text === category);
        expect(spans).toHaveLength(1);
        for (const span of spans) {
          const box = span.getBoundingRect().clone();
          const transform = span.getComputedTransform();
          if (transform) box.applyTransform(transform);
          const coordinate = chart.convertToPixel({ xAxisIndex: 0 }, index);
          if (typeof coordinate !== 'number') throw new Error('Expected scalar category coordinate');
          expect(box.x + box.width / 2, `类别必须对准数据坐标：${category}`).toBeCloseTo(coordinate, 1);
        }
      }
    } finally {
      chart.dispose();
    }
  });
});
