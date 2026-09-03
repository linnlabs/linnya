import { BrowserWindow, session } from 'electron';
import {
  assertAllowedWebUrl,
  resolveAndAssertPublicHost,
} from '../../tools/web/shared/urlPolicy';
import type {
  WebPageRenderRuntime,
  WebPageRenderSession,
  WebPageRenderWindow,
  WebPageRenderWindowOptions,
} from './definitions/webPageRenderRuntime';

export interface ElectronWebPageRenderRuntimeOptions {
  readonly validateRequestUrl?: (url: string) => Promise<void>;
}

async function validatePublicWebRequest(rawUrl: string): Promise<void> {
  const url = assertAllowedWebUrl(rawUrl);
  await resolveAndAssertPublicHost(url);
}

function createWindow(options: WebPageRenderWindowOptions): WebPageRenderWindow {
  const renderWindow = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: false,
      backgroundThrottling: false,
      partition: options.partition,
    },
  });
  const webContents = renderWindow.webContents;

  return {
    loadURL: (url) => renderWindow.loadURL(url),
    executeJavaScript: (script) => webContents.executeJavaScript(script),
    getURL: () => webContents.getURL(),
    isDestroyed: () => renderWindow.isDestroyed() || webContents.isDestroyed(),
    destroy: () => renderWindow.destroy(),
    installNavigationGuards: (isAllowed, onBlocked) => {
      const guardNavigation = (event: { preventDefault(): void }, targetUrl: string): void => {
        if (isAllowed(targetUrl)) return;
        event.preventDefault();
        onBlocked(targetUrl);
      };
      webContents.on('will-navigate', guardNavigation);
      webContents.on('will-redirect', guardNavigation);
      webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      return () => {
        if (webContents.isDestroyed()) return;
        webContents.off('will-navigate', guardNavigation);
        webContents.off('will-redirect', guardNavigation);
      };
    },
    onClosed: (listener) => {
      renderWindow.on('closed', listener);
      return () => {
        if (!renderWindow.isDestroyed()) renderWindow.off('closed', listener);
      };
    },
    onRenderProcessGone: (listener) => {
      const handleGone = (_event: unknown, details: { reason: string }): void => listener(details.reason);
      webContents.on('render-process-gone', handleGone);
      return () => {
        if (!webContents.isDestroyed()) webContents.off('render-process-gone', handleGone);
      };
    },
    onUnresponsive: (listener) => {
      renderWindow.on('unresponsive', listener);
      return () => {
        if (!renderWindow.isDestroyed()) renderWindow.off('unresponsive', listener);
      };
    },
  };
}

function createSession(
  partition: string,
  validateRequestUrl: (url: string) => Promise<void>,
): WebPageRenderSession {
  const renderSession = session.fromPartition(partition, { cache: false });
  const validatedHosts = new Map<string, Promise<void>>();
  return {
    clearStorageData: async () => {
      validatedHosts.clear();
      await renderSession.clearStorageData();
    },
    installSecurityGuards: () => {
      renderSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      renderSession.setPermissionCheckHandler(() => false);
      const cancelDownload = (event: { preventDefault(): void }, item: { cancel(): void }): void => {
        event.preventDefault();
        item.cancel();
      };
      renderSession.on('will-download', cancelDownload);
      const requestFilter = { urls: ['http://*/*', 'https://*/*'] };
      const validateRequest = (
        details: { url: string },
        callback: (response: { cancel: boolean }) => void,
      ): void => {
        let hostname: string;
        try {
          hostname = new URL(details.url).hostname.toLowerCase();
        } catch {
          callback({ cancel: true });
          return;
        }
        const validation = validatedHosts.get(hostname) ?? validateRequestUrl(details.url);
        validatedHosts.set(hostname, validation);
        void validation.then(
          () => callback({ cancel: false }),
          () => callback({ cancel: true }),
        );
      };
      renderSession.webRequest.onBeforeRequest(requestFilter, validateRequest);
      return () => {
        renderSession.setPermissionRequestHandler(null);
        renderSession.setPermissionCheckHandler(null);
        renderSession.off('will-download', cancelDownload);
        renderSession.webRequest.onBeforeRequest(requestFilter, null);
      };
    },
  };
}

export function createElectronWebPageRenderRuntime(
  options: ElectronWebPageRenderRuntimeOptions = {},
): WebPageRenderRuntime {
  const validateRequestUrl = options.validateRequestUrl ?? validatePublicWebRequest;
  return {
    createWindow,
    createSession: (partition) => createSession(partition, validateRequestUrl),
  };
}

export const electronWebPageRenderRuntime = createElectronWebPageRenderRuntime();
