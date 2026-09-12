import sharp from 'sharp';
import { invokeHiddenWorker } from '../../../../../src/electron-main/hidden-worker/standaloneHiddenWorkerRuntime';
import { parseSlideRasterResult, type SlideRasterRequest } from '../../src/shared/slideRasterization';
import type { PresentationRenderModel } from '../../src/shared/renderModel';

export const GENERATED_CHART_RASTER_SOURCE = `
const categories = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05', '2024-06'];
const trend = createSlide();
trend.add(createChart({
  chartType: 'line', position: { x: 0.5, y: 0.5, w: 9, h: 4.5 }, categories,
  series: [{ name: 'Rate', values: [10, 18, 12, 24, 20, 32], color: '#4472C4',
    lineWidth: 2, lineDash: 'dash', marker: 'diamond', showDataLabels: true, dataLabelFormat: '0.0' }],
  categoryAxis: { title: 'Month', labelRotation: 35 },
  valueAxis: { title: 'Rate', min: 0, max: 40, majorUnit: 10 },
  showDataLabels: true, dataLabelContent: 'value', legendPosition: 'bottom'
}));
const composition = createSlide();
composition.add(createChart({
  chartType: 'bar', position: { x: 0.5, y: 0.5, w: 9, h: 4.5 },
  categories: ['A', 'B', 'C', 'D'], stacking: 'percent',
  series: [
    { name: 'Observed', values: [40, 30, 50, 60], color: '#4472C4' },
    { name: 'Remaining', values: [60, 70, 50, 40], color: '#ED7D31' }
  ],
  valueAxis: { majorUnit: 0.25, numberFormat: '0%' },
  showDataLabels: true, dataLabelContent: 'value', dataLabelFormat: '0', legendPosition: 'bottom'
}));
compose({ title: 'Generated chart raster admission', layout: '16x9', slides: [trend, composition] });
`;

/** 真实 generated mapper 输出直接跨 backend/preload codec，不用手写 RenderModel 绕过映射。 */
export async function assertGeneratedChartRenders(model: PresentationRenderModel): Promise<void> {
  if (model.slides.length !== 2) throw new Error('Generated chart smoke requires both source pages');
  for (const slide of model.slides) {
    const raster = parseSlideRasterResult(await invokeHiddenWorker('slides-raster', {
      requestId: `generated-chart-${slide.index}`,
      slide,
      slideSize: model.slideSize,
      profile: { id: 'generated-chart-contract', viewportWidthPx: 960, viewportHeightPx: 540, pixelRatio: 1, format: 'png' },
    }));
    if (raster.status === 'failure') throw new Error(`${raster.error.code}: ${raster.error.message}`);
    const decoded = await sharp(raster.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== 960 || decoded.info.height !== 540) throw new Error('Generated chart PNG size drift');
    let bluePixels = 0;
    for (let offset = 0; offset < decoded.data.length; offset += 4) {
      if (Math.abs(decoded.data[offset] - 68) < 15
        && Math.abs(decoded.data[offset + 1] - 114) < 15
        && Math.abs(decoded.data[offset + 2] - 196) < 15
        && decoded.data[offset + 3] > 240) bluePixels += 1;
    }
    if (bluePixels < 100) throw new Error('Generated chart is blank or lost its series');
  }
  console.log('generated line/percent bar -> RenderModel -> worker codec -> PNG passed');
}

/** 非笛卡尔图表不能通过全图背景色伪造 plot-area，否则会覆盖图例通道。 */
export async function assertChartPlotBackgrounds(request: SlideRasterRequest): Promise<void> {
  const chart = request.slide.elements[0];
  if (chart?.kind !== 'chart') throw new Error('Chart fidelity requires a chart fixture');
  for (const chartType of ['pie', 'radar'] as const) {
    const raster = parseSlideRasterResult(await invokeHiddenWorker('slides-raster', {
      ...request,
      requestId: `chart-plot-${chartType}`,
      slide: { ...request.slide, elements: [{
        ...chart, chartType,
        plotBackgroundColor: '#123456', seriesLineWidth: 3,
        legend: { visible: true, position: 'right', labelStyle: { color: '#FFFFFF' } },
      }] },
    }));
    if (raster.status === 'failure') throw new Error(raster.error.message);
    const decoded = await sharp(raster.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const plot = (10 * decoded.info.width + 10) * 4;
    const legend = (10 * decoded.info.width + decoded.info.width - 10) * 4;
    if (decoded.data[plot] !== 18 || decoded.data[plot + 1] !== 52
      || decoded.data[plot + 2] !== 86 || decoded.data[plot + 3] !== 255
      || decoded.data[legend + 3] !== 0) {
      throw new Error(`${chartType}: plot background must preserve a transparent legend channel`);
    }
  }
  console.log('ECharts plot fidelity passed: pie/radar fill and transparent legend channels');
}
