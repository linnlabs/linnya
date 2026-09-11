import sharp from 'sharp';
import { invokeHiddenWorker } from '../../../../../src/electron-main/hidden-worker/standaloneHiddenWorkerRuntime';
import { parseSlideRasterResult, type SlideRasterRequest } from '../../src/shared/slideRasterization';

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
