import { describe, expect, it } from 'vitest';
import type { ChartRenderNode, GroupRenderNode, TableRenderNode, TextRenderNode } from '../../../types/render';
import { isKonvaChartTypeSupported, isKonvaNodeSupported } from './konvaSupport';

function createTextNode(id: string): TextRenderNode {
  return {
    id,
    kind: 'text',
    box: { x: 0, y: 0, w: 1, h: 1, unit: 'in' },
    zIndex: 0,
    paragraphs: [{ runs: [{ text: 'hello' }] }],
  };
}

function createTableNode(): TableRenderNode {
  return {
    id: 'table-1',
    kind: 'table',
    box: { x: 0, y: 0, w: 4, h: 2, unit: 'in' },
    zIndex: 0,
    columns: [2, 2],
    rows: [1, 1],
    cells: [
      { row: 0, col: 0, paragraphs: [{ runs: [{ text: 'A' }] }] },
      { row: 0, col: 1, paragraphs: [{ runs: [{ text: 'B' }] }] },
      { row: 1, col: 0, paragraphs: [{ runs: [{ text: 'C' }] }] },
      { row: 1, col: 1, paragraphs: [{ runs: [{ text: 'D' }] }] },
    ],
  };
}

function createChartNode(chartType: ChartRenderNode['chartType']): ChartRenderNode {
  return {
    id: 'chart-1',
    kind: 'chart',
    box: { x: 0, y: 0, w: 4, h: 3, unit: 'in' },
    zIndex: 1,
    chartType,
    categories: ['Q1', 'Q2'],
    palette: ['#B64646', '#4776B1'],
    series: [{ name: 'Revenue', values: [10, 20] }],
  };
}

describe('konvaSupport', () => {
  it('accepts all chart types currently implemented in renderer', () => {
    expect(isKonvaChartTypeSupported('bar')).toBe(true);
    expect(isKonvaChartTypeSupported('column')).toBe(true);
    expect(isKonvaChartTypeSupported('line')).toBe(true);
    expect(isKonvaChartTypeSupported('pie')).toBe(true);
    expect(isKonvaChartTypeSupported('doughnut')).toBe(true);
    expect(isKonvaChartTypeSupported('scatter')).toBe(true);
    expect(isKonvaChartTypeSupported('area')).toBe(true);
    expect(isKonvaChartTypeSupported('radar')).toBe(true);
    expect(isKonvaChartTypeSupported('combo')).toBe(true);
  });

  it('treats text/table/chart as Konva-compatible', () => {
    expect(isKonvaNodeSupported(createTextNode('text-1'))).toBe(true);
    expect(isKonvaNodeSupported(createTableNode())).toBe(true);
    expect(isKonvaNodeSupported(createChartNode('line'))).toBe(true);
  });

  it('checks group children recursively', () => {
    const groupNode: GroupRenderNode = {
      id: 'group-1',
      kind: 'group',
      box: { x: 0, y: 0, w: 5, h: 3, unit: 'in' },
      zIndex: 0,
      children: [
        createTextNode('text-1'),
        createChartNode('combo'),
      ],
    };

    expect(isKonvaNodeSupported(groupNode)).toBe(true);
  });
});
