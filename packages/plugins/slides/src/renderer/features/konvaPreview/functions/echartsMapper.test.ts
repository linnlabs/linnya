import { describe, expect, it } from 'vitest';
import type { ChartRenderNode } from '../../../types/render';
import {
  formatDataLabelValue,
  mapChartNodeToEChartsOption,
} from './echartsMapper';

function createChartNode(overrides: Partial<ChartRenderNode> = {}): ChartRenderNode {
  return {
    id: 'chart-1',
    kind: 'chart',
    box: { x: 0, y: 0, w: 4, h: 3, unit: 'in' },
    zIndex: 1,
    chartType: 'column',
    palette: ['#4472C4', '#ED7D31', '#A5A5A5'],
    categories: ['Q1', 'Q2'],
    series: [
      { name: 'Revenue', values: [20, 30] },
      { name: 'Cost', values: [10, 15] },
    ],
    ...overrides,
  };
}

describe('echartsMapper', () => {
  it('returns a transparent non-animated option for empty chart series', () => {
    const option = mapChartNodeToEChartsOption(createChartNode({ series: [] }));

    expect(option).toEqual({
      animation: false,
      backgroundColor: 'transparent',
    });
  });

  it('maps percent stacked column charts to normalized bar series and a 0-100 value axis', () => {
    const option = mapChartNodeToEChartsOption(
      createChartNode({
        stacking: 'percent',
        categories: ['Q1'],
        series: [
          { name: 'Revenue', values: [20] },
          { name: 'Cost', values: [30] },
        ],
      }),
    );

    expect(option).toMatchObject({
      xAxis: { type: 'category', data: ['Q1'] },
      yAxis: { type: 'value', min: 0, max: 100 },
      series: [
        {
          name: 'Revenue',
          type: 'bar',
          data: [40],
          stack: 'total',
          barGap: '50%',
        },
        {
          name: 'Cost',
          type: 'bar',
          data: [60],
          stack: 'total',
          barGap: '50%',
        },
      ],
    });
  });

  it('maps pie chart slices from categories and category palette', () => {
    const option = mapChartNodeToEChartsOption(
      createChartNode({
        chartType: 'pie',
        categories: ['North', 'South', 'West'],
        series: [{ name: 'Share', values: [10, 20, 30] }],
        dataLabels: { visible: true },
      }),
    );

    expect(option).toMatchObject({
      series: [{
        type: 'pie',
        radius: ['0%', '70%'],
        data: [
          { name: 'North', value: 10, itemStyle: { color: '#4472C4' } },
          { name: 'South', value: 20, itemStyle: { color: '#ED7D31' } },
          { name: 'West', value: 30, itemStyle: { color: '#A5A5A5' } },
        ],
        label: { show: true },
      }],
      legend: { show: false },
    });
  });

  it('formats PPT-style data labels', () => {
    expect(formatDataLabelValue(1234.56, '$#,##0.0')).toBe('$1,234.6');
    expect(formatDataLabelValue(42, '#0"%"')).toBe('42%');
    expect(formatDataLabelValue(0.42, '0.0%')).toBe('42.0%');
    expect(formatDataLabelValue(1234.56, '$#,##0.0"B"')).toBe('$1,234.6B');
  });
});
