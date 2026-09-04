import { app } from 'electron';
import sharp from 'sharp';
import { electronPdfDocumentRuntime } from '../../../../../src/electron-main/desktop-capabilities/pdf-document';

const PAGE_WIDTH_INCHES = 13.333;
const PAGE_HEIGHT_INCHES = 7.5;

async function run(): Promise<void> {
  try {
    const pages = await Promise.all([
      createPage('#2563EB'),
      createPage('#DC2626'),
    ]);
    const bytes = await electronPdfDocumentRuntime.raster.render({
      pageWidthInches: PAGE_WIDTH_INCHES,
      pageHeightInches: PAGE_HEIGHT_INCHES,
      pages,
    });
    if (!Buffer.from(bytes.subarray(0, 5)).equals(Buffer.from('%PDF-'))) {
      throw new Error('Raster PDF runtime returned invalid PDF bytes');
    }

    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // PDF.js 6 明确拒绝 Node Buffer；复制成普通 Uint8Array 也避免测试把
    // Electron runtime 返回值的底层内存所有权交给 loading task。
    const loadingTask = getDocument({ data: Uint8Array.from(bytes) });
    const document = await loadingTask.promise;
    try {
      if (document.numPages !== 2) {
        throw new Error(`Raster PDF runtime returned ${document.numPages} pages instead of 2`);
      }
      const firstPage = await document.getPage(1);
      const viewport = firstPage.getViewport({ scale: 1 });
      assertNear(viewport.width, PAGE_WIDTH_INCHES * 72, 'width');
      assertNear(viewport.height, PAGE_HEIGHT_INCHES * 72, 'height');
    } finally {
      await loadingTask.destroy();
    }
    console.log(`Slides raster PDF passed: 2 pages, ${bytes.byteLength} bytes`);
  } finally {
    app.quit();
  }
}

function createPage(color: string): Promise<Buffer> {
  return sharp({
    create: {
      width: 320,
      height: 180,
      channels: 4,
      background: color,
    },
  }).png().toBuffer();
}

function assertNear(actual: number, expected: number, dimension: string): void {
  if (Math.abs(actual - expected) > 1) {
    throw new Error(`Raster PDF ${dimension} drifted: actual=${actual}, expected=${expected}`);
  }
}

console.log('Starting Slides raster PDF smoke');
// 独立 smoke 的 hidden PDF window 会在打印后销毁；由脚本自己的 finally 决定退出。
app.on('window-all-closed', () => {});
void app.whenReady().then(() => {
  void run().catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
});
