import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import { init } from 'echarts';
import JSZip from 'jszip';
import PptxGenJS from 'pptxgenjs';
import { describe, expect, it } from 'vitest';
import type { StructuredElement } from '@plugin/slides/shared';
import { addNativeChart, type ChartPptxPatch } from '../engine/chart/chartPptx';
import { applyChartPptxStyles } from '../engine/chart/applyChartPptxStyles';
import { StructuredCompiler } from '../engine/StructuredCompiler';
import { directChildren, getElementByTag, getElements } from '../engine/parser/xml/XmlNode';
import { mapChartNodeToEChartsOption } from '../../renderer/features/konvaPreview/functions/echartsMapper';
import { renderSlide } from './helpers/render-model-mapping-harness';

type Chart = Extract<StructuredElement, { type: 'chart' }>;
const categories = ['Alpha', 'Beta', 'Gamma'];
const names = ['North', 'South', 'West'];
const colors = ['#2468C4', '#D85C28', '#33854B'];
const values = [[12, 22, 32], [18, 28, 38], [24, 34, 44]];

function horizontalChart(stacking: Chart['stacking'] = 'none', styled = false): Chart {
  return {
    type: 'chart', chartType: 'bar', stacking,
    position: { x: 0.5, y: 0.5, w: 9, h: 4.5 },
    data: { categories, series: names.map((name, index) => ({
      name, labels: categories, values: values[index], color: colors[index],
      ...(styled ? { showDataLabels: true, pointColors: colors } : {}),
    })) },
    chartStyle: { fontFamily: 'Arial', axisLabelFontSize: 12, legendFontSize: 12 },
    ...(stacking === 'percent' ? {} : { valueAxis: { min: 0, max: 50, majorUnit: 10 } }),
    options: { barDir: 'bar', barGapWidthPct: 50, showLegend: true, legendPos: 'b', showValue: true },
  };
}

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
function required(parent: Parameters<typeof getElementByTag>[0], tag: string): Element {
  const element = getElementByTag(parent, tag);
  if (!element) throw new Error(`Missing ${tag}`);
  return element;
}

describe('横向条形的作者阅读顺序', () => {
  it.each([
    ['none', false], ['none', true], ['stacked', false], ['stacked', true], ['percent', false], ['percent', true],
  ] as const)('%s / 系列样式补丁=%s：只反向类目轴，缓存与工作簿保留作者顺序', async (stacking, styled) => {
    const element = horizontalChart(stacking, styled);
    const zip = await JSZip.loadAsync(await new StructuredCompiler().compileDeck({
      title: 'Horizontal reading order', slides: [{ slideNumber: 1, spec: { type: 'structured', elements: [element] } }],
    }));
    const doc = parse(await zip.file(/ppt\/charts\/chart\d+\.xml$/)[0].async('text'));
    const category = required(doc, 'c:catAx');
    const value = required(doc, 'c:valAx');
    expect(required(category, 'c:orientation').getAttribute('val')).toBe('maxMin');
    expect(required(value, 'c:orientation').getAttribute('val')).toBe('minMax');
    expect(required(value, 'c:axPos').getAttribute('val')).toBe('b');
    expect(required(value, 'c:crosses').getAttribute('val')).toBe('max');
    expect(required(value, 'c:tickLblPos').getAttribute('val')).toBe('nextTo');
    expect(getElements(value, 'c:crossesAt')).toHaveLength(0);
    expect(required(category, 'c:crosses').getAttribute('val')).toBe('autoZero');

    // ECMA-376 CT_ValAx：crosses 与 crossesAt 互斥，且必须在 crossBetween 前。
    const valueFields = getElements(value, '*').filter(node => node.parentNode === value).map(node => node.tagName);
    expect(valueFields.slice(valueFields.indexOf('c:crossAx'), valueFields.indexOf('c:crossBetween') + 1))
      .toEqual(['c:crossAx', 'c:crosses', 'c:crossBetween']);
    expect(getElements(required(category, 'c:scaling'), '*').map(node => node.tagName)).toEqual(['c:orientation']);

    const series = getElements(doc, 'c:ser');
    expect(series.map(ser => required(ser, 'c:idx').getAttribute('val'))).toEqual(['0', '1', '2']);
    expect(series.map(ser => required(ser, 'c:order').getAttribute('val'))).toEqual(['0', '1', '2']);
    for (const [index, ser] of series.entries()) {
      expect(required(required(ser, 'c:tx'), 'c:v').textContent).toBe(names[index]);
      const cachedCategories = directChildren(required(required(ser, 'c:cat'), 'c:lvl'), 'c:pt');
      expect(cachedCategories.map(point => required(point, 'c:v').textContent)).toEqual(categories);
      expect(cachedCategories.map(point => point.getAttribute('idx'))).toEqual(['0', '1', '2']);
      expect(directChildren(required(ser, 'c:numCache'), 'c:pt').map(point => Number(required(point, 'c:v').textContent)))
        .toEqual(values[index]);
    }

    const workbook = await JSZip.loadAsync(await zip.file(/ppt\/embeddings\/.*\.xlsx$/)[0].async('nodebuffer'));
    const strings = getElements(parse(await workbook.file('xl/sharedStrings.xml')!.async('text')), 'si').map(item => item.textContent);
    const sheet = parse(await workbook.file('xl/worksheets/sheet1.xml')!.async('text'));
    const rows = getElements(sheet, 'row').map(row => directChildren(row, 'c').map(cell => {
      const raw = required(cell, 'v').textContent;
      return cell.getAttribute('t') === 's' ? strings[Number(raw)] : Number(raw);
    }));
    expect(rows).toEqual([
      ['', ...names],
      ...categories.map((name, index) => [name, ...values.map(seriesValues => seriesValues[index])]),
    ]);

    const node = renderSlide([element]).elements[0];
    if (node.kind !== 'chart') throw new Error('Expected chart');
    expect(mapChartNodeToEChartsOption(node)).toMatchObject({
      yAxis: { inverse: true, data: categories },
      xAxis: { type: 'value', position: 'bottom', axisLine: { onZero: false } },
      series: names.map(name => ({ name })),
      legend: { data: names },
    });
  });

  it('替换显式 crossesAt，不留下两个互斥的交叉设置', async () => {
    const element = horizontalChart();
    element.options = { ...element.options, catAxisCrossesAt: 1 };
    const pptx = new PptxGenJS();
    const plan: ChartPptxPatch[] = [];
    addNativeChart(pptx.addSlide(), element, undefined, { plan, slideIndex: 0 });
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
    await applyChartPptxStyles(zip, plan);
    const value = required(parse(await zip.file(/ppt\/charts\/chart\d+\.xml$/)[0].async('text')), 'c:valAx');
    expect(getElements(value, 'c:crossesAt')).toHaveLength(0);
    expect(getElements(value, 'c:crosses').map(node => node.getAttribute('val'))).toEqual(['max']);
  });

  it.each(['column', 'line', 'doughnut'] as const)('%s 不触发横向方向补丁，轴 XML 与图表布局保持不变', async (type) => {
    const element = horizontalChart();
    element.chartType = type === 'column' ? 'bar' : type;
    element.options = { ...element.options, barDir: 'col' };
    if (type === 'doughnut') element.data.series = element.data.series.slice(0, 1);
    const pptx = new PptxGenJS();
    const plan: ChartPptxPatch[] = [];
    addNativeChart(pptx.addSlide(), element, undefined, { plan, slideIndex: 0 });
    expect(plan[0].horizontalBar).toBe(false);
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
    const file = zip.file(/ppt\/charts\/chart\d+\.xml$/)[0];
    const before = parse(await file.async('text'));
    const serializer = new XMLSerializer();
    const axes = (doc: typeof before) => [...getElements(doc, 'c:catAx'), ...getElements(doc, 'c:valAx')]
      .map(axis => serializer.serializeToString(axis));
    await applyChartPptxStyles(zip, plan);
    const after = parse(await zip.file(file.name)!.async('text'));
    expect(axes(after)).toEqual(axes(before));
    const node = renderSlide([element]).elements[0];
    if (node.kind !== 'chart' || !node.layout) throw new Error('Expected chart layout');
    expect(plan[0].layout).toEqual(node.layout);
  });
});

describe('横向条形的共享文字占位', () => {
  it.each([12, 18])('%s pt 的类目与值轴端点文字完整位于画布内，实际条形遵守作者顺序', (fontSize) => {
    const element = horizontalChart();
    element.chartStyle = { ...element.chartStyle, axisLabelFontSize: fontSize };
    const node = renderSlide([element]).elements[0];
    if (node.kind !== 'chart' || !node.layout) throw new Error('Expected chart layout');
    const width = node.box.w * 96;
    const height = node.box.h * 96;
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width, height });
    try {
      const option = mapChartNodeToEChartsOption(node);
      expect(option).toMatchObject({ grid: {
        outerBoundsMode: 'none', left: node.layout.plot.x * width, width: node.layout.plot.w * width,
      } });
      chart.setOption(option);
      const display = chart.getZr().storage.getDisplayList(true);
      for (const text of [...categories, '0', '50']) {
        const span = display.find(item => item.style.text === text);
        if (!span) throw new Error(`Expected complete axis label: ${text}`);
        const box = span.getBoundingRect().clone();
        const transform = span.getComputedTransform();
        if (transform) box.applyTransform(transform);
        expect(box.x, text).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, text).toBeLessThanOrEqual(width);
        expect(box.y, text).toBeGreaterThanOrEqual(0);
        expect(box.y + box.height, text).toBeLessThanOrEqual(height);
      }
      const firstCategory = chart.convertToPixel({ yAxisIndex: 0 }, 0);
      const lastCategory = chart.convertToPixel({ yAxisIndex: 0 }, 2);
      expect(firstCategory).toBeLessThan(lastCategory);
      const bars = colors.map(color => display.find(item => item.style.fill === color)?.getBoundingRect());
      if (bars.some(box => !box)) throw new Error('Expected all bar series');
      expect(bars[0]?.y).toBeLessThan(bars[1]?.y ?? 0);
      expect(bars[1]?.y).toBeLessThan(bars[2]?.y ?? 0);
    } finally { chart.dispose(); }
  });
});
