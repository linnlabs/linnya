import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { init } from 'echarts';
import type { StructuredElement } from '@plugin/slides/shared';
import { isSlideRenderModel } from '../../shared/renderModel/renderModelCodec';
import { StructuredCompiler } from '../engine/StructuredCompiler';
import { getElementByTag, getElements } from '../engine/parser/xml/XmlNode';
import { renderSlide } from './helpers/render-model-mapping-harness';
import { mapChartNodeToEChartsOption } from '../../renderer/features/konvaPreview/functions/echartsMapper';

describe('共享图表布局到预览与原生 PPTX', () => {
  it('饼图外部标签按系列的格式与可见性预留空间', () => {
    const plotWidth = (showDataLabels: boolean, dataLabelFormat: string) => {
      const node = renderSlide([{
        type: 'chart', chartType: 'pie', position: { x: 0, y: 0, w: 4, h: 3 },
        data: { categories: ['A', 'B', 'C'], series: [{ name: 'Share', labels: [], values: [12, 24, 36], showDataLabels, dataLabelFormat }] },
        options: { showValue: true },
      }]).elements[0];
      if (node.kind !== 'chart' || !node.layout) throw new Error('Expected shared pie plot');
      return node.layout.plot.w;
    };
    const short = plotWidth(true, 'General');
    expect(plotWidth(true, '0" million USD"')).toBeLessThan(short);
    expect(plotWidth(false, '0" million USD"')).toBeGreaterThan(short);
  });

  it.each(['column', 'bar', 'line', 'pie', 'doughnut'] as const)('%s 显式投影绘图区和四侧图例，未声明的数值轴仍自动适应', async (chartType) => {
    for (const legendPos of ['l', 'r', 't', 'b'] as const) {
      const element: Extract<StructuredElement, { type: 'chart' }> = {
        type: 'chart', chartType: chartType === 'column' ? 'bar' : chartType, position: { x: 1, y: 1, w: 6, h: 3 },
        data: {
          categories: ['North', 'South', 'West'],
          series: [{ name: 'Revenue across regions', labels: [], values: [12, 24, 36] }],
        },
        options: { showLegend: true, legendPos, ...(chartType === 'bar' ? { barDir: 'bar' } : {}) },
        chartStyle: { fontFamily: 'Arial', axisLabelFontSize: 10, legendFontSize: 10 },
      };
      const slide = renderSlide([element]);
      const node = slide.elements[0];
      if (node.kind !== 'chart') throw new Error('Expected chart');
      expect(node.layout).toBeDefined();
      if (!node.layout) throw new Error('Expected resolved layout');
      expect(isSlideRenderModel(slide)).toBe(true);
      const zip = await JSZip.loadAsync(await new StructuredCompiler().compileDeck({
        title: 'Chart layout', slides: [{ slideNumber: 1, spec: { type: 'structured', elements: [element] } }],
      }));
      const file = zip.file(/ppt\/charts\/chart\d+\.xml$/)[0];
      const doc = new DOMParser().parseFromString(await file.async('text'), 'application/xml');
      const plot = getElementByTag(doc, 'c:plotArea');
      const legend = getElementByTag(doc, 'c:legend');
      if (!plot || !legend || !node.layout.legend) throw new Error('Expected native layout owners');
      for (const [owner, expected] of [[plot, node.layout.plot], [legend, node.layout.legend.box]] as const) {
        const manual = getElementByTag(owner, 'c:manualLayout');
        expect(manual).toBeDefined();
        if (!manual) throw new Error('Expected manual layout');
        for (const key of ['x', 'y', 'w', 'h'] as const) {
          expect(Number(getElementByTag(manual, `c:${key}`)?.getAttribute('val'))).toBeCloseTo(expected[key], 10);
        }
        expect(getElementByTag(manual, 'c:wMode')?.getAttribute('val')).toBe('factor');
        expect(getElementByTag(manual, 'c:hMode')?.getAttribute('val')).toBe('factor');
      }
      expect(getElements(doc, 'c:min')).toHaveLength(0);
      expect(getElements(doc, 'c:max')).toHaveLength(0);
      expect(getElements(doc, 'c:majorUnit')).toHaveLength(0);
      const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 576, height: 288 });
      try {
        const option = mapChartNodeToEChartsOption(node);
        chart.setOption(option);
        if (chartType === 'column' || chartType === 'bar' || chartType === 'line') {
          expect(option).toMatchObject({ grid: {
            outerBoundsMode: 'none', left: node.layout.plot.x * node.box.w * 96, top: node.layout.plot.y * node.box.h * 96,
            width: node.layout.plot.w * node.box.w * 96, height: node.layout.plot.h * node.box.h * 96,
          } });
          const horizontal = chartType === 'bar';
          const first = chart.convertToPixel(horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 }, 0);
          expect(first).toBeCloseTo(horizontal
            ? (node.layout.plot.y + node.layout.plot.h / 6) * 288
            : (node.layout.plot.x + node.layout.plot.w / 6) * 576, 8);
        }
        expect(chart.renderToSVGString()).toContain(chartType === 'pie' || chartType === 'doughnut' ? 'North' : 'Revenue across regions');
      } finally { chart.dispose(); }
      const invalidSlide = structuredClone(slide);
      const invalid = invalidSlide.elements[0];
      if (invalid.kind === 'chart' && invalid.layout) invalid.layout.plot.w = -1;
      expect(isSlideRenderModel(invalidSlide)).toBe(false);
    }
  });

  it('按文本占位拆成多行图例，并保留显式轴范围与步长', async () => {
    const element: Extract<StructuredElement, { type: 'chart' }> = {
      type: 'chart', chartType: 'bar', position: { x: 0, y: 0, w: 4, h: 3 },
      data: { categories: ['A', 'B'], series: ['First regional revenue', 'Second regional revenue', 'Third regional revenue']
        .map(name => ({ name, labels: [], values: [10, 30] })) },
      valueAxis: { min: -10, max: 50, majorUnit: 10 },
      options: { showLegend: true, legendPos: 'b' },
    };
    const node = renderSlide([element]).elements[0];
    if (node.kind !== 'chart') throw new Error('Expected chart');
    expect(node.layout?.legend?.lines.length).toBeGreaterThan(1);
    expect(mapChartNodeToEChartsOption(node)).toMatchObject({ yAxis: { min: -10, max: 50, interval: 10 } });
    const preview = init(null, undefined, { renderer: 'svg', ssr: true, width: 384, height: 288 });
    try {
      preview.setOption(mapChartNodeToEChartsOption(node));
      const rows = new Set<number>();
      for (const series of element.data.series) {
        const span = preview.getZr().storage.getDisplayList(true).find(item => item.style.text === series.name);
        if (!span || !node.layout?.legend) throw new Error('Expected complete legend');
        const box = span.getBoundingRect().clone();
        const transform = span.getComputedTransform();
        if (transform) box.applyTransform(transform);
        rows.add(box.y);
        const legend = node.layout.legend.box;
        expect(box.y).toBeGreaterThanOrEqual(legend.y * 288);
        expect(box.y + box.height).toBeLessThanOrEqual((legend.y + legend.h) * 288);
      }
      expect(rows.size).toBe(node.layout?.legend?.lines.length);
    } finally { preview.dispose(); }
    const zip = await JSZip.loadAsync(await new StructuredCompiler().compileDeck({
      title: 'Explicit axes', slides: [{ slideNumber: 1, spec: { type: 'structured', elements: [element] } }],
    }));
    const doc = new DOMParser().parseFromString(await zip.file(/ppt\/charts\/chart\d+\.xml$/)[0].async('text'), 'application/xml');
    for (const [key, value] of [['min', -10], ['max', 50], ['majorUnit', 10]] as const) {
      expect(getElementByTag(doc, `c:${key}`)?.getAttribute('val')).toBe(String(value));
    }
  });

  it.each([
    { horizontal: false, legendPos: 'b' }, { horizontal: true, legendPos: 'b' },
    { horizontal: false, legendPos: 't' }, { horizontal: true, legendPos: 't' },
    { horizontal: false, legendPos: 'l' }, { horizontal: true, legendPos: 'r' },
  ] as const)('紧凑图的长轴标题不被共享 plot 裁出画布（横向=$horizontal，图例=$legendPos）', ({ horizontal, legendPos }) => {
    const element: Extract<StructuredElement, { type: 'chart' }> = {
      type: 'chart', chartType: 'bar', position: { x: 0, y: 0, w: 8.9, h: 2.36 },
      data: { categories: ['分层1', '分层2', '分层3', '分层4'], series: [{ name: '类别A', labels: [], values: [32, 40, 9, 55] }] },
      categoryAxis: { title: horizontal ? '行内占比（归一化到 100%）' : '分层（每层是独立分母）' },
      valueAxis: { title: horizontal ? '分层（每层是独立分母）' : '行内占比（归一化到 100%）' },
      chartStyle: { fontFamily: 'Arial', axisLabelFontSize: 8, legendFontSize: 8 },
      options: { showLegend: true, legendPos, ...(horizontal ? { barDir: 'bar' } : {}) },
    };
    const node = renderSlide([element]).elements[0];
    if (node.kind !== 'chart') throw new Error('Expected chart');
    const width = node.box.w * 96;
    const height = node.box.h * 96;
    const preview = init(null, undefined, { renderer: 'svg', ssr: true, width, height });
    try {
      preview.setOption(mapChartNodeToEChartsOption(node));
      for (const title of [element.categoryAxis?.title, element.valueAxis?.title]) {
        const span = preview.getZr().storage.getDisplayList(true).find(item => item.style.text === title);
        if (!span) throw new Error('Expected axis title');
        const box = span.getBoundingRect().clone();
        const transform = span.getComputedTransform();
        if (transform) box.applyTransform(transform);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y + box.height).toBeLessThanOrEqual(height);
      }
    } finally { preview.dispose(); }
  });
});
