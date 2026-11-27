import { BrowserWindow, session } from 'electron';
import {
  assertAllowedWebUrl,
  resolveAndAssertPublicHost,
} from '../../tools/web/shared/urlPolicy';
import type { WebResponseHeaderLookup } from '../../tools/web/shared/webAccessChallenge';
import type {
  WebPageRenderNavigationTrigger,
  WebPageRenderResponseDecision,
  WebPageRenderSubresourceEvent,
  WebPageRenderRuntime,
  WebPageRenderSession,
  WebPageRenderWindow,
  WebPageRenderWindowOptions,
} from './definitions/webPageRenderRuntime';

export interface ElectronWebPageRenderRuntimeOptions {
  readonly validateRequestUrl?: (url: string) => Promise<void>;
  /** 文本抓取默认启用 Blink `images: false` 并取消图片/媒体/字体请求，既防内存暴涨又避免触发 img.onerror。 */
  readonly blockHeavyResources?: boolean;
}

function isSseRequestHeaders(
  requestHeaders: Record<string, string | string[]> | undefined,
): boolean {
  if (!requestHeaders) return false;
  for (const [name, value] of Object.entries(requestHeaders)) {
    if (name.toLowerCase() !== 'accept') continue;
    const joined = Array.isArray(value) ? value.join(', ') : value;
    if (joined.toLowerCase().includes('text/event-stream')) return true;
  }
  return false;
}

async function validatePublicWebRequest(rawUrl: string): Promise<void> {
  const url = assertAllowedWebUrl(rawUrl);
  await resolveAndAssertPublicHost(url);
}

function createResponseHeaderLookup(
  responseHeaders: Record<string, string[]> | undefined,
): WebResponseHeaderLookup {
  const headers = new Map<string, string>();
  for (const [name, values] of Object.entries(responseHeaders ?? {})) {
    const key = name.toLowerCase();
    const previous = headers.get(key);
    const joined = values.join(', ');
    headers.set(key, previous === undefined ? joined : `${previous}, ${joined}`);
  }
  return { get: (name) => headers.get(name.toLowerCase()) };
}

function createWindow(
  options: WebPageRenderWindowOptions,
  blockHeavyResources: boolean,
): WebPageRenderWindow {
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
      images: !blockHeavyResources,
      partition: options.partition,
    },
  });
  const webContents = renderWindow.webContents;

  return {
    loadURL: (url) => renderWindow.loadURL(url),
    // webContents.executeJavaScript 会挂起到页面停止加载；主框架执行才能从 DOM 就绪起采样。
    executeJavaScript: (script) => webContents.mainFrame.executeJavaScript(script),
    getURL: () => webContents.getURL(),
    isDestroyed: () => renderWindow.isDestroyed() || webContents.isDestroyed(),
    destroy: () => renderWindow.destroy(),
    installNavigationGuards: (isAllowed, onBlocked, onDidNavigate) => {
      const guardNavigation = (
        event: { preventDefault(): void },
        targetUrl: string,
        trigger: WebPageRenderNavigationTrigger,
      ): void => {
        if (isAllowed(targetUrl, trigger)) return;
        event.preventDefault();
        onBlocked(targetUrl);
      };
      const guardWillNavigate = (event: { preventDefault(): void }, targetUrl: string): void => {
        guardNavigation(event, targetUrl, 'navigate');
      };
      const guardWillRedirect = (
        event: { preventDefault(): void },
        targetUrl: string,
        _isInPlace: boolean,
        isMainFrame: boolean,
      ): void => {
        // 只拦截主框架重定向；子框架网络跳转另有 session 准入，且同源内联会在后续单独判定。
        if (!isMainFrame) return;
        guardNavigation(event, targetUrl, 'redirect');
      };
      const handleDidNavigate = (_event: unknown, targetUrl: string): void => {
        onDidNavigate?.(targetUrl);
      };
      webContents.on('will-navigate', guardWillNavigate);
      webContents.on('will-redirect', guardWillRedirect);
      webContents.on('did-navigate', handleDidNavigate);
      webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      return () => {
        if (webContents.isDestroyed()) return;
        webContents.off('will-navigate', guardWillNavigate);
        webContents.off('will-redirect', guardWillRedirect);
        webContents.off('did-navigate', handleDidNavigate);
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
    onDomReady: (listener) => {
      webContents.on('dom-ready', listener);
      return () => {
        if (!webContents.isDestroyed()) webContents.off('dom-ready', listener);
      };
    },
  };
}

function createSession(
  partition: string,
  validateRequestUrl: (url: string) => Promise<void>,
  blockHeavyResources: boolean,
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
        details: { url: string; resourceType: string },
        callback: (response: { cancel: boolean }) => void,
      ): void => {
        if (
          blockHeavyResources
          && (details.resourceType === 'image'
            || details.resourceType === 'media'
            || details.resourceType === 'font')
        ) {
          callback({ cancel: true });
          return;
        }
        let hostname: string;
        try {
          hostname = new URL(details.url).hostname.toLowerCase();
        } catch {
          callback({ cancel: true });
          return;
        }
        // 主框架每次导航/重定向都重新检查 URL 和 DNS，不能沿用同主机子资源的历史准入。
        const isNavigation = details.resourceType === 'mainFrame';
        const validation = isNavigation
          ? validateRequestUrl(details.url)
          : validatedHosts.get(hostname) ?? validateRequestUrl(details.url);
        if (!isNavigation) validatedHosts.set(hostname, validation);
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
    observeMainFrameResponses: (listener) => {
      const responseFilter = { urls: ['http://*/*', 'https://*/*'] };
      const handleHeaders = (
        details: {
          url: string;
          resourceType: string;
          statusCode: number;
          responseHeaders?: Record<string, string[]>;
        },
        callback: (response: { cancel?: boolean }) => void,
      ): void => {
        if (details.resourceType !== 'mainFrame') {
          callback({});
          return;
        }
        let decision: WebPageRenderResponseDecision;
        try {
          decision = listener({
            url: details.url,
            statusCode: details.statusCode,
            headers: createResponseHeaderLookup(details.responseHeaders),
          });
        } catch {
          // 判定缺失时拒绝该主文档，不让页面继续执行；异常也不能逃逸到 Electron 网络回调。
          decision = 'cancel';
        }
        callback(decision === 'cancel' ? { cancel: true } : {});
      };
      renderSession.webRequest.onHeadersReceived(responseFilter, handleHeaders);
      return () => {
        renderSession.webRequest.onHeadersReceived(responseFilter, null);
      };
    },
    observeSubresources: (listener) => {
      const subresourceFilter = { urls: ['http://*/*', 'https://*/*'] };
      const ignoredDataRequestIds = new Set<number>();
      const categorize = (resourceType: string): WebPageRenderSubresourceEvent['category'] | undefined => {
        if (resourceType === 'xhr') return 'data';
        if (resourceType === 'script' || resourceType === 'stylesheet') return 'script_or_style';
        return undefined;
      };
      const emit = (
        details: {
          id: number;
          resourceType: string;
          error?: string;
          requestHeaders?: Record<string, string | string[]>;
        },
        phase: WebPageRenderSubresourceEvent['phase'],
      ): void => {
        const category = categorize(details.resourceType);
        if (!category) return;
        if (category === 'data') {
          if (phase === 'started') {
            if (isSseRequestHeaders(details.requestHeaders)) {
              ignoredDataRequestIds.add(details.id);
              return;
            }
          } else if (ignoredDataRequestIds.delete(details.id)) {
            return;
          }
        }
        listener({
          id: details.id,
          category,
          phase,
          ...(phase === 'failed' && details.error ? { error: details.error } : {}),
        });
      };
      renderSession.webRequest.onSendHeaders(subresourceFilter, (details) => emit(details, 'started'));
      renderSession.webRequest.onCompleted(subresourceFilter, (details) => emit(details, 'completed'));
      renderSession.webRequest.onErrorOccurred(subresourceFilter, (details) => emit(details, 'failed'));
      return () => {
        ignoredDataRequestIds.clear();
        renderSession.webRequest.onSendHeaders(subresourceFilter, null);
        renderSession.webRequest.onCompleted(subresourceFilter, null);
        renderSession.webRequest.onErrorOccurred(subresourceFilter, null);
      };
    },
  };
}

export function createElectronWebPageRenderRuntime(
  options: ElectronWebPageRenderRuntimeOptions = {},
): WebPageRenderRuntime {
  const validateRequestUrl = options.validateRequestUrl ?? validatePublicWebRequest;
  const blockHeavyResources = options.blockHeavyResources ?? true;
  return {
    createWindow: (windowOptions) => createWindow(windowOptions, blockHeavyResources),
    createSession: (partition) => createSession(partition, validateRequestUrl, blockHeavyResources),
  };
}

export const electronWebPageRenderRuntime = createElectronWebPageRenderRuntime();
