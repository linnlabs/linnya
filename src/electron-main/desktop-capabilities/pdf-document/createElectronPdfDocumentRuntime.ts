import { BrowserWindow, type PrintToPDFOptions } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { RasterPdfDocumentRequest } from '@linnya/plugin-host-contract/backend/pdfDocumentRuntime';
import type { DesktopRasterPdfDocumentPort } from '../../../app-hosts/linnya/desktop-capabilities';
import { ExportArtifactRequestInvalidError } from '../../../features/system/export/definitions/exportErrors';
import { assertRasterPdfDocumentRequest } from '../../../features/system/export/functions/assertRasterPdfDocumentRequest';
import { buildRasterPdfDocumentHtml } from '../../../features/system/export/functions/buildRasterPdfDocumentHtml';

const PDF_RUNTIME_TIMEOUT_MS = 60_000;

export interface ElectronPdfDocumentRuntime {
  readonly raster: DesktopRasterPdfDocumentPort;
  renderHtml(htmlContent: string): Promise<Uint8Array>;
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new Error(`Chromium PDF runtime timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function renderLoadedDocumentToPdf(input: {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly load: (window: BrowserWindow) => Promise<void>;
  readonly printOptions: PrintToPDFOptions;
}): Promise<Uint8Array> {
  const pdfWindow = new BrowserWindow({
    show: false,
    width: input.viewportWidth,
    height: input.viewportHeight,
    webPreferences: {
      contextIsolation: true,
      javascript: false,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  // PDF runtime 只加载调用方已经提供的受控文档，不允许任何页面打开新窗口。
  pdfWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  try {
    await withTimeout(input.load(pdfWindow), PDF_RUNTIME_TIMEOUT_MS, () => {
      pdfWindow.destroy();
    });
    return await withTimeout(
      pdfWindow.webContents.printToPDF(input.printOptions),
      PDF_RUNTIME_TIMEOUT_MS,
      () => pdfWindow.destroy(),
    );
  } finally {
    if (!pdfWindow.isDestroyed()) {
      pdfWindow.destroy();
    }
  }
}

async function renderHtml(htmlContent: string): Promise<Uint8Array> {
  if (htmlContent.trim().length === 0) {
    throw new ExportArtifactRequestInvalidError('htmlContent');
  }
  return renderLoadedDocumentToPdf({
    viewportWidth: 1024,
    viewportHeight: 768,
    load: window => window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`,
    ),
    printOptions: {
      preferCSSPageSize: true,
      printBackground: true,
    },
  });
}

async function renderRaster(request: RasterPdfDocumentRequest): Promise<Uint8Array> {
  // Reverse capability 跨进程后仍在 Desktop 入站处复核，不能只信任 Backend facade。
  assertRasterPdfDocumentRequest(request);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'linnya-pdf-document-'));
  try {
    const pageFiles = request.pages.map((_page, index) => ({
      fileName: `page-${String(index + 1).padStart(4, '0')}.png`,
    }));
    await Promise.all(request.pages.map((page, index) => (
      fs.writeFile(path.join(temporaryRoot, pageFiles[index].fileName), page, { flag: 'wx' })
    )));
    await fs.writeFile(
      path.join(temporaryRoot, 'document.html'),
      buildRasterPdfDocumentHtml({
        pageWidthInches: request.pageWidthInches,
        pageHeightInches: request.pageHeightInches,
        pages: pageFiles,
      }),
      { encoding: 'utf8', flag: 'wx' },
    );

    return await renderLoadedDocumentToPdf({
      viewportWidth: Math.ceil(request.pageWidthInches * 96),
      viewportHeight: Math.ceil(request.pageHeightInches * 96),
      load: window => window.loadFile(path.join(temporaryRoot, 'document.html')),
      printOptions: {
        pageSize: {
          width: request.pageWidthInches,
          height: request.pageHeightInches,
        },
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        preferCSSPageSize: true,
        printBackground: true,
      },
    });
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function createElectronPdfDocumentRuntime(): ElectronPdfDocumentRuntime {
  return Object.freeze({
    raster: Object.freeze({ render: renderRaster }),
    renderHtml,
  });
}

/** Electron shell 内唯一的无状态 PDF runtime；Backend bundle 只取得其中的 raster 窄端口。 */
export const electronPdfDocumentRuntime = createElectronPdfDocumentRuntime();
