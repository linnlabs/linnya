import type { DeckSpec, FreeformSlideSpec, StructuredElement, TextStyle } from '../../src/shared';
import { PLOT_COLOR, SERIES_COLORS } from './definitions';

/** 所有正文、系列名和数值均为固定合成内容，无工作区或用户数据输入。 */
export function createConformanceSamples(): { deck: DeckSpec; pageIds: string[] } {
  const textPage = (
    content: string,
    style: TextStyle,
    w: number,
    h: number
  ): FreeformSlideSpec => ({
    type: 'freeform',
    elements: [
      {
        type: 'text',
        content,
        textWrap: 'word',
        position: { x: 1, y: 1, w, h },
        style: { color: '#111111', fontFamily: 'Arial', fontSize: 24, ...style },
      },
    ],
  });
  const slides: DeckSpec['slides'] = [
    {
      slideNumber: 1,
      spec: textPage(
        'Boundary words wrap near the right edge. 中文边界，标点与 mixed words。',
        {},
        3.05,
        0.6
      ),
    },
    {
      slideNumber: 2,
      spec: {
        type: 'freeform',
        elements: [
          {
            type: 'shape',
            geometry: 'rect',
            position: { x: 1, y: 1, w: 2.8, h: 0.72 },
            content:
              'Shrink this synthetic shape text\nSecond line with more words\nThird line 中文缩字',
            style: {
              fontFamily: 'Arial',
              fontSize: 28,
              color: '#111111',
              fill: '#F5F5F5',
              lineSpacing: { kind: 'multiple', value: 1.2 },
            },
          },
        ],
      },
    },
    {
      slideNumber: 3,
      spec: textPage(
        '春风徐来，清水长流。\n纵向文字 ABC 123。',
        { writingMode: 'vertical-rl' },
        2.4,
        3.5
      ),
    },
    {
      slideNumber: 4,
      spec: {
        type: 'freeform',
        elements: [
          {
            type: 'text',
            content: 'Multiple spacing\nSecond line\nThird line',
            position: { x: 1, y: 1, w: 3, h: 2 },
            style: {
              fontFamily: 'Arial',
              fontSize: 24,
              color: '#111111',
              lineSpacing: { kind: 'multiple', value: 1.4 },
            },
          },
          {
            type: 'text',
            content: 'Exact spacing\nSecond line\nThird line',
            position: { x: 5, y: 1, w: 3, h: 2 },
            style: {
              fontFamily: 'Arial',
              fontSize: 24,
              color: '#111111',
              lineSpacing: { kind: 'exactPt', value: 32 },
            },
          },
        ],
      },
    },
  ];
  const pageIds = ['text-boundary', 'shape-shrink', 'vertical', 'line-spacing'];
  type Chart = Extract<StructuredElement, { type: 'chart' }>;
  const chart = (): Chart => ({
    type: 'chart',
    chartType: 'bar',
    position: { x: 0.5, y: 0.5, w: 9, h: 4.5 },
    data: {
      categories: ['Alpha', 'Beta', 'Gamma'],
      series: SERIES_COLORS.map((color, index) => ({
        name: ['North', 'South', 'West'][index],
        labels: ['Alpha', 'Beta', 'Gamma'],
        values: [
          [12, 22, 32],
          [18, 28, 38],
          [24, 34, 44],
        ][index],
        color,
      })),
    },
    chartStyle: {
      plotBackgroundColor: PLOT_COLOR,
      fontFamily: 'Arial',
      axisLabelFontSize: 12,
      legendFontSize: 12,
    },
    valueAxis: { min: 0, max: 50, majorUnit: 10 },
    options: {
      barDir: 'col',
      barGapWidthPct: 50,
      barOverlapPct: 0,
      showLegend: true,
      legendPos: 'b',
      showValue: true,
    },
  });
  const appendChart = (id: string, element: Chart) => {
    pageIds.push(id);
    slides.push({
      slideNumber: slides.length + 1,
      spec: { type: 'structured', elements: [element] },
    });
  };
  for (const [gap, overlap] of [
    [50, 0],
    [300, 50],
  ]) {
    const element = chart();
    appendChart(`chart-gap${gap}-overlap${overlap}`, {
      ...element,
      options: { ...element.options, barGapWidthPct: gap, barOverlapPct: overlap },
    });
  }
  const line = chart();
  appendChart('chart-line', {
    ...line,
    chartType: 'line',
    data: {
      ...line.data,
      series: line.data.series.map(series => ({ ...series, marker: 'circle' })),
    },
    options: { showLegend: true, legendPos: 'b', showValue: true },
  });
  const horizontal = chart();
  appendChart('chart-horizontal-bar', {
    ...horizontal,
    options: { ...horizontal.options, barDir: 'bar' },
  });
  const doughnut = chart();
  appendChart('chart-doughnut', {
    ...doughnut,
    chartType: 'doughnut',
    data: {
      categories: ['Alpha', 'Beta', 'Gamma'],
      series: [
        {
          name: 'Share',
          labels: ['Alpha', 'Beta', 'Gamma'],
          values: [25, 35, 40],
          pointColors: SERIES_COLORS,
        },
      ],
    },
    valueAxis: undefined,
    dataLabelContent: 'percentage',
    dataLabelPosition: 'center',
    options: { showLegend: true, legendPos: 'b', showValue: true, holeSize: 55 },
  });
  for (const [id, legendPos] of [
    ['right', 'r'],
    ['top', 't'],
  ]) {
    const element = chart();
    appendChart(`chart-legend-${id}`, { ...element, options: { ...element.options, legendPos } });
  }
  const deck: DeckSpec = {
    title: 'Synthetic PowerPoint conformance',
    layout: { width: 10, height: 5.625, unit: 'in' },
    theme: { fonts: { major: 'Arial', minor: 'Arial' } },
    slides,
  };
  return { deck, pageIds };
}

export function createConformanceDeck(): DeckSpec {
  return createConformanceSamples().deck;
}
