import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { slideFile, type Manifest } from './definitions';

/** PDF.js 的 Node CanvasFactory 类型是 Object；在此窄适配中验证实际 API，避免伪装成 DOM canvas。 */
function method(target: object, name: string): (...args: unknown[]) => unknown {
  const value: unknown = Reflect.get(target, name);
  if (typeof value !== 'function') throw new Error(`PDF.js Node canvas missing ${name}`);
  return (...args) => Reflect.apply(value, target, args);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('PDF.js returned invalid object');
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
export async function rasterizeOfficePdf(
  pdf: string,
  output: string,
  manifest: Manifest
): Promise<void> {
  const task = getDocument({ data: Uint8Array.from(await readFile(pdf)), useSystemFonts: true });
  try {
    const document = await task.promise;
    if (document.numPages !== manifest.pages.length)
      throw new Error('PowerPoint PDF page count differs from manifest');
    for (let index = 0; index < document.numPages; index++) {
      const page = await document.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: manifest.width / base.width });
      if (Math.abs(viewport.height - manifest.height) > 1)
        throw new Error('PowerPoint PDF aspect ratio differs');
      const handle = record(
        method(document.canvasFactory, 'create')(manifest.width, manifest.height)
      );
      try {
        const renderTask = record(
          method(
            page,
            'render'
          )({
            canvas: null,
            canvasContext: handle.context,
            viewport,
            background: 'rgb(255,255,255)',
          })
        );
        await renderTask.promise;
        if (typeof handle.canvas !== 'object' || handle.canvas === null)
          throw new Error('PDF.js canvas unavailable');
        const bytes = method(handle.canvas, 'toBuffer')('image/png');
        if (!(bytes instanceof Uint8Array)) throw new Error('PDF.js canvas did not encode PNG');
        await writeFile(path.join(output, slideFile(index)), bytes);
      } finally {
        method(document.canvasFactory, 'destroy')(handle);
        page.cleanup();
      }
    }
  } finally {
    await task.destroy();
  }
}
