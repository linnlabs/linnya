import { createRequire } from 'node:module';
import path from 'node:path';

import type * as PdfJsModule from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';

const moduleRequire = createRequire(
  typeof __filename === 'string' ? __filename : path.join(process.cwd(), 'package.json')
);
const PDFJS_CANVAS_MAX_AREA_BYTES = 32 * 1024 * 1024;

let runtimePromise: Promise<typeof PdfJsModule> | null = null;

export interface OpenPdfDocument {
  readonly document: PDFDocumentProxy;
  close(): Promise<void>;
}

interface PdfJsAssetDirectories {
  readonly cMapUrl: string;
  readonly iccUrl: string;
  readonly standardFontDataUrl: string;
  readonly wasmUrl: string;
}

/**
 * PDF.js 6 是纯 ESM。App Server 与 Queue Worker 都运行在 Node 24 中，直接使用
 * Node 的动态 import，避免再维护一份只能在特定 bundle 目录工作的 CJS loader。
 */
export function loadPdfJsRuntime(): Promise<typeof PdfJsModule> {
  runtimePromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return runtimePromise;
}

/**
 * 打开一个 PDF.js 文档会持有解析缓存和字体资源，调用方必须执行 close()。
 * 这里统一配置随 pdfjs-dist 安装的 CMap、标准字体、ICC 与 WASM，保证源码开发和
 * Desktop 打包使用同一份资源，不依赖系统安装。
 */
export async function openPdfDocument(data: Uint8Array): Promise<OpenPdfDocument> {
  const pdfjs = await loadPdfJsRuntime();
  const assets = resolvePdfJsAssetDirectories();
  const loadingTask: PDFDocumentLoadingTask = pdfjs.getDocument({
    // PDF.js 可能把 TypedArray 转移给内部 worker；复制一次，避免改变调用方持有的输入。
    data: new Uint8Array(data),
    cMapUrl: assets.cMapUrl,
    cMapPacked: true,
    iccUrl: assets.iccUrl,
    standardFontDataUrl: assets.standardFontDataUrl,
    wasmUrl: assets.wasmUrl,
    useWorkerFetch: false,
    // 禁止 Skia 扫描并缓存整套系统字体。PDF 内嵌字体与 pdfjs-dist 自带的标准字体
    // 足以覆盖正式解析路径，系统字体回退会让首个简单 PDF 的 RSS 瞬间增加数百 MiB。
    useSystemFonts: false,
    // PDF.js 在 Node 中拿不到浏览器的 Canvas 上限。默认 -1 会通过创建越来越大的
    // OffscreenCanvas 探测极限，首次打开 PDF 就可能制造数百 MiB RSS 峰值。
    // 栅格结果最长边只有 1536px，32 MiB（约 8.4M RGBA 像素）足以保留输入细节，
    // 同时让超大扫描图在解码阶段主动降采样。
    canvasMaxAreaInBytes: PDFJS_CANVAS_MAX_AREA_BYTES,
  });

  try {
    const document = await loadingTask.promise;
    let closed = false;
    return {
      document,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await loadingTask.destroy();
      },
    };
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    throw error;
  }
}

function resolvePdfJsAssetDirectories(): PdfJsAssetDirectories {
  const packageRoot = path.dirname(moduleRequire.resolve('pdfjs-dist/package.json'));
  return Object.freeze({
    cMapUrl: withTrailingSeparator(path.join(packageRoot, 'cmaps')),
    iccUrl: withTrailingSeparator(path.join(packageRoot, 'iccs')),
    standardFontDataUrl: withTrailingSeparator(path.join(packageRoot, 'standard_fonts')),
    wasmUrl: withTrailingSeparator(path.join(packageRoot, 'wasm')),
  });
}

function withTrailingSeparator(directory: string): string {
  return directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;
}
