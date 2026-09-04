import fs from 'node:fs/promises';

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

import {
  PDF_RASTER_DEFAULT_TARGET_PIXELS,
  PDF_RASTER_JPEG_QUALITY,
  type PdfRasterDocument,
  type RasterizedPdfPage,
  normalizePdfRasterTargetPixels,
} from '../definitions/pdfRaster';
import { PdfLocalConversionError } from '../definitions/ocrErrors';
import { openPdfDocument, type OpenPdfDocument } from './pdfJsRuntime';

interface PdfJsCanvasHandle {
  readonly canvas: object;
  readonly context: object;
}

/**
 * 从内存打开一次 PDF，后续页面复用同一个 PDF.js 文档和解析缓存。
 * 同一文档的绘制会串行执行，避免多个 RGBA Canvas 同时放大峰值内存；OCR 层仍可与
 * 下一页渲染流水并行。
 */
export async function openPdfRasterDocumentFromBytes(data: Uint8Array): Promise<PdfRasterDocument> {
  const handle = await openPdfDocument(data);
  return createPdfRasterDocument(handle);
}

export async function openPdfRasterDocumentFromPath(pdfPath: string): Promise<PdfRasterDocument> {
  const bytes = await fs.readFile(pdfPath);
  return openPdfRasterDocumentFromBytes(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  );
}

function createPdfRasterDocument(handle: OpenPdfDocument): PdfRasterDocument {
  let closed = false;
  let renderQueue: Promise<void> = Promise.resolve();

  return {
    pageCount: handle.document.numPages,
    renderPageToJpeg(
      pageNumber: number,
      options: { readonly targetPixels?: number } = {}
    ): Promise<RasterizedPdfPage> {
      if (closed) return Promise.reject(new Error('PDF 栅格化文档已经关闭'));
      const operation = renderQueue.then(() =>
        renderPageToJpeg(
          handle.document,
          pageNumber,
          options.targetPixels ?? PDF_RASTER_DEFAULT_TARGET_PIXELS
        )
      );
      renderQueue = operation.then(
        () => undefined,
        () => undefined
      );
      return operation;
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await renderQueue;
      await handle.close();
    },
  };
}

async function renderPageToJpeg(
  document: PDFDocumentProxy,
  pageNumber: number,
  requestedTargetPixels: number
): Promise<RasterizedPdfPage> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.numPages) {
    throw new PdfLocalConversionError(`PDF 页码超出范围: ${pageNumber}/${document.numPages}`, {
      pageNum: pageNumber,
      tool: 'pdfjs-canvas',
    });
  }

  const startedAt = performance.now();
  const targetPixels = normalizePdfRasterTargetPixels(requestedTargetPixels);
  let page: PDFPageProxy | null = null;
  let canvasHandle: PdfJsCanvasHandle | null = null;

  try {
    page = await document.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const longestSide = Math.max(baseViewport.width, baseViewport.height);
    if (!Number.isFinite(longestSide) || longestSide <= 0) {
      throw new Error(`PDF 页面尺寸无效: ${baseViewport.width}x${baseViewport.height}`);
    }

    const viewport = page.getViewport({ scale: targetPixels / longestSide });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    canvasHandle = createCanvasHandle(document, width, height);

    await renderPdfPage(page, {
      canvas: null,
      canvasContext: canvasHandle.context,
      viewport,
      background: 'rgb(255,255,255)',
    });
    const jpegBytes = await encodeCanvasAsJpeg(canvasHandle.canvas);

    return {
      pageNumber,
      width,
      height,
      jpegBytes,
      renderDurationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    if (error instanceof PdfLocalConversionError) throw error;
    throw new PdfLocalConversionError(
      `PDF.js 页面渲染失败: ${error instanceof Error ? error.message : String(error)}`,
      { pageNum: pageNumber, tool: 'pdfjs-canvas', cause: error }
    );
  } finally {
    page?.cleanup();
    if (canvasHandle) destroyCanvasHandle(document, canvasHandle);
  }
}

function createCanvasHandle(
  document: PDFDocumentProxy,
  width: number,
  height: number
): PdfJsCanvasHandle {
  const factory = document.canvasFactory;
  const create = Reflect.get(factory, 'create');
  if (typeof create !== 'function') {
    throw new Error('PDF.js Node CanvasFactory 不可用');
  }
  const candidate: unknown = Reflect.apply(create, factory, [width, height]);
  if (!isRecord(candidate)) throw new Error('PDF.js CanvasFactory 返回值无效');
  const canvas = candidate.canvas;
  const context = candidate.context;
  if (!isRecord(canvas) || !isRecord(context)) {
    throw new Error('PDF.js CanvasFactory 未返回 canvas/context');
  }
  return { canvas, context };
}

async function renderPdfPage(page: PDFPageProxy, parameters: object): Promise<void> {
  const render = Reflect.get(page, 'render');
  if (typeof render !== 'function') throw new Error('PDF.js 页面缺少 render()');
  const renderTask: unknown = Reflect.apply(render, page, [parameters]);
  if (!isRecord(renderTask)) throw new Error('PDF.js render() 返回值无效');

  // 复杂页面可能包含大量绘制操作。每个内部绘制片段都回到事件循环后再继续，
  // 因而即便该入口临时运行在 App Server，也不会长时间独占其事件循环。
  Reflect.set(renderTask, 'onContinue', (continueRendering: unknown) => {
    if (typeof continueRendering !== 'function') return;
    setImmediate(() => Reflect.apply(continueRendering, undefined, []));
  });

  const promise: unknown = renderTask.promise;
  if (!isPromiseLike(promise)) throw new Error('PDF.js RenderTask 缺少 promise');
  await promise;
}

async function encodeCanvasAsJpeg(canvas: object): Promise<Buffer> {
  const encode = Reflect.get(canvas, 'encode');
  if (typeof encode !== 'function') throw new Error('Node Canvas 缺少异步 encode()');
  const encoded: unknown = await Reflect.apply(encode, canvas, ['jpeg', PDF_RASTER_JPEG_QUALITY]);
  if (!Buffer.isBuffer(encoded) || encoded.byteLength === 0) {
    throw new Error('Node Canvas 未生成有效 JPEG');
  }
  return encoded;
}

function destroyCanvasHandle(document: PDFDocumentProxy, canvasHandle: PdfJsCanvasHandle): void {
  const factory = document.canvasFactory;
  const destroy = Reflect.get(factory, 'destroy');
  if (typeof destroy === 'function') {
    Reflect.apply(destroy, factory, [canvasHandle]);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function';
}
