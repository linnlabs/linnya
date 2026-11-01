import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { resolveFont } from '@plugin/backend/fontResolution';
import { createSystemTextMeasurementRuntime } from '@plugin/backend/textMeasurement';
import { invokeHiddenWorker } from '../../../../../src/electron-main/hidden-worker/standaloneHiddenWorkerRuntime';
import type { PresentationRenderModel } from '../../src/shared/renderModel';
import { parseSlideRasterResult } from '../../src/shared/slideRasterization';
import { buildTextLineConfigs } from '../../src/renderer/features/konvaPreview/functions/builders/textBuilder';

/** 编译、真实字面测量、主预览共用 builder、离屏像素一起验收；只查 b/i 字段会漏掉本次回归。 */
export async function assertTextEmphasisFidelity(
  families: readonly string[],
  compile: (source: string, id: string) => Promise<PresentationRenderModel>,
): Promise<void> {
  const measurement = createSystemTextMeasurementRuntime();
  await measurement.initialize();
  const output = path.resolve(__dirname, 'text-emphasis-fidelity');
  await mkdir(output, { recursive: true });
  try {
    for (const [index, family] of [...new Set(families)].entries()) {
      if (family === 'PingFang SC') {
        const regular = resolveFont({ family, bold: false, italic: false, script: 'eastAsian' });
        const bold = resolveFont({ family, bold: true, italic: false, script: 'eastAsian' });
        assert.equal(bold.resolved?.bold, true, 'PingFang Semibold must participate in bold face selection');
        assert.notEqual(bold.resolved?.faceFingerprint, regular.resolved?.faceFingerprint);
      }
      const digests = new Map<string, string>();
      for (const variant of [
        { name: 'normal', bold: false, italic: false },
        { name: 'bold', bold: true, italic: false },
        { name: 'italic', bold: false, italic: true },
        { name: 'both', bold: true, italic: true },
        { name: 'removed', bold: false, italic: false },
      ]) {
        const model = await compile(createSource(family, variant), `emphasis-${index}-${variant.name}`);
        const text = model.slides[0]?.elements.find(node => node.kind === 'text');
        assert.ok(text?.kind === 'text', 'Missing compiled emphasis text');
        assert.equal(text.layout?.advanceSource, 'harfbuzz');
        const expectedStyle = [variant.italic ? 'italic' : '', variant.bold ? 'bold' : ''].filter(Boolean).join(' ') || 'normal';
        assert.ok(buildTextLineConfigs(text).every(config => config.fontStyle === expectedStyle),
          `${family}/${variant.name}: preview lost author emphasis`);
        const raster = parseSlideRasterResult(await invokeHiddenWorker('slides-raster', {
          requestId: `emphasis-${index}-${variant.name}`, slide: model.slides[0], slideSize: model.slideSize,
          profile: { id: 'text-emphasis-fidelity-v1', viewportWidthPx: 960, viewportHeightPx: 540, pixelRatio: 1, format: 'png' },
        }));
        assert.ok(raster.status === 'success', `${family}/${variant.name}: raster failed`);
        const pixels = await sharp(raster.bytes).raw().toBuffer();
        digests.set(variant.name, createHash('sha256').update(pixels).digest('hex'));
        await writeFile(path.join(output, `${index}-${variant.name}.png`), raster.bytes);
      }
      assert.equal(new Set(['normal', 'bold', 'italic', 'both'].map(name => digests.get(name))).size, 4,
        `${family}: emphasis buttons must produce four distinct pixel results`);
      assert.equal(digests.get('removed'), digests.get('normal'), `${family}: removing authored emphasis must restore normal pixels`);
      console.log(`Text emphasis fidelity passed: ${family}, four distinct HarfBuzz/raster states and explicit removal`);
    }
  } finally {
    measurement.dispose();
  }
}

function createSource(family: string, style: { name: string; bold: boolean; italic: boolean }): string {
  return `const slide = createSlide({ slideKey: 'page', background: { color: '#FFFFFF' } });
const text = createText({ editKey: 'caption', content: '复利增长 Revenue 30%' });
text.position = 'absolute'; text.x = 0.5; text.y = 0.5; text.w = 10; text.h = 1;
text.fontSize = 32; text.color = '#111111';
text.fontWeight = ${JSON.stringify(style.name === 'removed' ? 'bold' : 'normal')};
text.fontStyle = ${JSON.stringify(style.name === 'removed' ? 'italic' : 'normal')};
slide.add(text);
compose({ title: 'Text emphasis fidelity', slides: [slide],
  theme: { fonts: { major: ${JSON.stringify(family)}, minor: ${JSON.stringify(family)} } },
  manualEdits: { version: 2, slides: [{ slideKey: 'page', targets: [{ kind: 'text', editKey: 'caption', bold: ${style.bold}, italic: ${style.italic} }] }] }
});`;
}
