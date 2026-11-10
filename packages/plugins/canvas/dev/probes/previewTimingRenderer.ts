import { z } from 'zod';
import { createDocumentPreviewSurface } from '@linnya/document-preview';
import { createHtmlCardRasterizer } from '../../src/renderer/capabilities/textRasterization';
import { previewTimingFixture } from './previewParityFixture';

const MemorySchema = z.object({ usedJSHeapSize: z.number(), totalJSHeapSize: z.number(), jsHeapSizeLimit: z.number() });
function memory() {
  const value: unknown = Reflect.get(performance, 'memory');
  return value === undefined ? null : MemorySchema.parse(value);
}
async function nextFrame(): Promise<void> { return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
let held: ImageBitmap[] = [];
function release() { held.forEach(image => image.close()); held = []; document.body.replaceChildren(); }

async function measureBasics(mode: 'first' | 'full' | 'chart') {
  document.body.style.cssText = 'margin:0;background:#fff';
  const preview = previewTimingFixture(document), samples: unknown[] = [];
  for (const temperature of ['cold', 'warm']) {
    const started = performance.now();
    if (mode === 'chart') {
      const charts = await import('@linnya/markdown-document-core/workspace-charts');
      const result = await charts.renderChartImageSvg({ spec: { chartType: 'bar', title: '单图 SSR', categories: ['甲', '乙', '丙'], series: [{ name: '数值', values: [2, 4, 3] }] },
        theme: charts.baseChartTheme('light'), width: 360, locale: 'zh-CN', messages: { secondaryAxis: '右轴', shareOfWhole: '占整体', share: '占比' } });
      samples.push({ temperature, milliseconds: performance.now() - started, svgCharacters: result.svg.length, width: result.width, height: result.height });
    } else {
      const surface = await createDocumentPreviewSurface({ preview, document, widthPx: 360, ...(mode === 'first' ? { maxHeight: 320 } : {}), theme: 'light', signal: new AbortController().signal });
      document.body.append(surface.element); await document.fonts.ready; surface.element.getBoundingClientRect();
      samples.push({ temperature, milliseconds: performance.now() - started, renderedBlocks: surface.element.querySelectorAll('.workspace-preview-block').length,
        renderedImages: surface.element.querySelectorAll('img').length, memory: memory() });
      surface.dispose();
    }
  }
  return { mode, scope: 'Fresh renderer per mode; cold is first function call, warm is one immediate repeat. Does not include bundle startup.', samples };
}

async function measureBatch(temperature: 'cold' | 'warm') {
  release(); const baselineMemory = memory(), preview = previewTimingFixture(document), started = performance.now();
  const sources = [];
  for (let index = 0; index < 100; index++) {
    const surface = await createDocumentPreviewSurface({ preview: { ...preview, documentId: `timing-${index}` }, document, widthPx: 240, maxHeight: 320, theme: 'light', signal: new AbortController().signal });
    sources.push(surface);
  }
  const domReadyMs = performance.now() - started, domMemory = memory(), staging = document.createElement('div'); document.body.append(staging);
  const rasterizer = createHtmlCardRasterizer({ host: staging });
  try {
    const rasterStarted = performance.now();
    const rasters = await rasterizer.rasterizeBatch(sources.map(source => ({ element: source.element, width: 240, height: 320, scale: 1 })));
    const rasterMs = performance.now() - rasterStarted;
    held = rasters.map(result => result.bitmap);
    const mosaic = document.createElement('canvas'); mosaic.width = 2400; mosaic.height = 3200;
    const context = mosaic.getContext('2d'); if (!context) throw new Error('timing_mosaic_context_missing');
    context.fillStyle = '#fff'; context.fillRect(0, 0, 2400, 3200);
    held.forEach((bitmap, index) => context.drawImage(bitmap, index % 10 * 240, Math.floor(index / 10) * 320));
    document.body.append(mosaic); await nextFrame();
    const totalMs = performance.now() - started;
    return { temperature, cards: held.length, domReadyMs, rasterMs, totalMs, bitmapBytes: held.reduce((sum, image) => sum + image.width * image.height * 4, 0),
      width: mosaic.width, height: mosaic.height, memory: { baseline: baselineMemory, dom: domMemory, withBitmaps: memory() } };
  } finally { sources.forEach(source => source.dispose()); rasterizer.dispose(); staging.remove(); }
}
Object.defineProperty(window, 'measurePreviewBasics', { value: measureBasics });
Object.defineProperty(window, 'measurePreviewBatch', { value: measureBatch });
Object.defineProperty(window, 'snapshotPreviewBatch', { value: () => {
  const canvas = document.body.querySelector('canvas'); if (!canvas) throw new Error('timing_mosaic_missing'); return canvas.toDataURL('image/png');
} });
Object.defineProperty(window, 'releasePreviewBatch', { value: release });
