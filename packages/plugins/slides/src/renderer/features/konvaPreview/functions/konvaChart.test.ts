import { describe, expect, it } from 'vitest';
import type { ChartRenderNode } from '../../../types/render';
import {
  buildClusterBarThickness,
  buildCartesianRange,
  buildChartFrame,
  buildRadarPoints,
  CHART_AXIS_STROKE,
  CHART_LABEL_FILL,
  CHART_LABEL_FONT_FAMILY,
  CHART_LABEL_FONT_SIZE,
  pointsToFlatArray,
  resolveChartPalette,
  resolveSeriesType,
  snapRect,
  snapStrokeCenter,
  valueToX,
  valueToY,
} from './konvaChart';

const comboChart: ChartRenderNode = {
  id: 'chart-1',
  kind: 'chart',
  box: { x: 0, y: 0, w: 6, h: 3, unit: 'in' },
  zIndex: 0,
  chartType: 'combo',
  categories: ['Q1', 'Q2', 'Q3'],
  palette: ['#B64646', '#4776B1', '#59714B'],
  series: [
    { name: 'Revenue', values: [10, 20, 30], chartType: 'column' },
    { name: 'Margin', values: [0.2, 0.24, 0.27], chartType: 'line', color: '#EF4444' },
  ],
};

describe('konvaChart', () => {
  it('uses series colors first, then default palette', () => {
    expect(resolveChartPalette(comboChart)).toEqual(['#B64646', '#EF4444']);
  });

  it('resolves combo series type per series', () => {
    expect(resolveSeriesType(comboChart, comboChart.series[0])).toBe('column');
    expect(resolveSeriesType(comboChart, comboChart.series[1])).toBe('line');
  });

  it('builds a stable cartesian frame and value range', () => {
    const frame = buildChartFrame(600, 320, { visible: true, position: 'right' });
    const range = buildCartesianRange(comboChart);

    expect(frame).toMatchObject({
      plotX: 52,
      plotY: 20,
      rightGutter: 128,
    });
    expect(range).toMatchObject({
      min: 0,
      max: 30,
    });
  });

  it('maps values into plot coordinates', () => {
    const frame = buildChartFrame(600, 320);
    const range = { min: 0, max: 40 };

    expect(valueToX(20, range, frame)).toBe(frame.plotX + frame.plotWidth / 2);
    expect(valueToY(40, range, frame)).toBe(frame.plotY);
    expect(valueToY(0, range, frame)).toBe(frame.plotY + frame.plotHeight);
  });

  it('builds radar point arrays that stay flattenable for Konva', () => {
    const points = buildRadarPoints([8, 6, 9], ['A', 'B', 'C'], 300, 240);
    const flattened = pointsToFlatArray(points);

    expect(points).toHaveLength(3);
    expect(flattened).toHaveLength(6);
  });

  it('reserves bottom gutter when legend is shown below the chart', () => {
    const frame = buildChartFrame(600, 320, { visible: true, position: 'bottom' });

    // 底部图例空间现在按字体和图表类型动态计算，不再使用早期固定值。
    expect(frame.bottomGutter).toBe(78);
    expect(frame.plotHeight).toBe(320 - frame.topGutter - frame.bottomGutter);
  });

  it('uses Office-like chart defaults for labels and axis styling', () => {
    expect(CHART_AXIS_STROKE).toBe('#888888');
    expect(CHART_LABEL_FILL).toBe('#000000');
    expect(CHART_LABEL_FONT_FAMILY).toBe('Arial');
    expect(CHART_LABEL_FONT_SIZE).toBe(12);
  });

  it('matches PPT gap-width semantics when sizing clustered bars', () => {
    expect(buildClusterBarThickness(120, 2, 36)).toBeCloseTo(34.286, 3);
    expect(buildClusterBarThickness(120, 1, 36)).toBe(36);
  });

  it('snaps 1px strokes and filled bars onto stable pixel boundaries', () => {
    expect(snapStrokeCenter(10)).toBe(10.5);
    expect(snapStrokeCenter(10.49)).toBe(10.5);

    expect(snapRect(12.2, 20.4, 30.6, 9.7)).toEqual({
      x: 12,
      y: 20,
      width: 31,
      height: 10,
    });
  });
});
