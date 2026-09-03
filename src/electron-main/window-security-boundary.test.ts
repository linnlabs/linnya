import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const windowManagerPath = path.resolve(process.cwd(), 'src/electron-main/window-manager.js');
const exportHandlersPath = path.resolve(process.cwd(), 'src/electron-main/ipc/export-handlers.js');
const pdfRuntimePath = path.resolve(
  process.cwd(),
  'src/electron-main/desktop-capabilities/pdf-document/createElectronPdfDocumentRuntime.ts',
);
const webRenderRuntimePath = path.resolve(
  process.cwd(),
  'src/electron-main/web-render/electronWebPageRenderRuntime.ts',
);

describe('electron window security boundary', () => {
  it('keeps the main window from opening or navigating to external pages', () => {
    const source = readFileSync(windowManagerPath, 'utf8');

    expect(source).toContain('setWindowOpenHandler(() => ({ action: \'deny\' }))');
    expect(source).toContain('will-navigate');
    expect(source).toContain('isAllowedMainWindowNavigation');
    expect(source).not.toContain("targetUrl.startsWith('media://')");
    expect(source).not.toContain('protocol === \'media:\'');
  });

  it('keeps the PDF offscreen window scriptless and unable to open new windows', () => {
    const source = readFileSync(pdfRuntimePath, 'utf8');

    expect(source).toContain('javascript: false');
    expect(source).toContain('sandbox: true');
    expect(source).toContain('nodeIntegration: false');
    expect(source).toContain('webSecurity: true');
    expect(source).toContain('pdfWindow.webContents.setWindowOpenHandler(() => ({ action: \'deny\' }))');
    expect(readFileSync(exportHandlersPath, 'utf8')).toContain('electronPdfDocumentRuntime.renderHtml');
  });

  it('keeps the remote web renderer sandboxed and denies privileged browser actions', () => {
    const source = readFileSync(webRenderRuntimePath, 'utf8');

    expect(source).toContain('nodeIntegration: false');
    expect(source).toContain('contextIsolation: true');
    expect(source).toContain('sandbox: true');
    expect(source).toContain('webSecurity: true');
    expect(source).toContain('partition: options.partition');
    expect(source).not.toContain('preload:');
    expect(source).not.toContain('javascript: false');
    expect(source).toContain("webContents.on('will-navigate'");
    expect(source).toContain("webContents.on('will-redirect'");
    expect(source).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
    expect(source).toContain('setPermissionRequestHandler');
    expect(source).toContain('setPermissionCheckHandler');
    expect(source).toContain("renderSession.on('will-download'");
    expect(source).toContain('item.cancel()');
    expect(source).toContain('resolveAndAssertPublicHost');
    expect(source).toContain('renderSession.webRequest.onBeforeRequest');
  });
});
