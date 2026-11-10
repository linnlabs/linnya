import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { Logger } from '../../../shared/logger';

import type {
  BackendRendererRequestRpcGatewayPort,
} from '../../../app-hosts/linnya/adapters/backend-renderer-requests';
import { getMainWindow } from '../../window-manager';

interface ElectronInvokeRegistrarPort {
  handle(
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>,
  ): void;
}

/**
 * 将 App Server 自己登记的业务 channel 精确映射回 Electron IPC。Main 不解释 payload，
 * 但仍独占 renderer 身份 admission 与导航/崩溃取消，raw App Server RPC 不进入 preload。
 */
export async function registerBackendRendererRequestIpcHandlers(input: {
  readonly gateway: BackendRendererRequestRpcGatewayPort;
  readonly ipc?: ElectronInvokeRegistrarPort;
  readonly readMainWindow?: () => BrowserWindow | null;
}): Promise<readonly string[]> {
  const ipc = input.ipc ?? ipcMain;
  const readMainWindow = input.readMainWindow ?? getMainWindow;
  const channels = await input.gateway.listChannels();
  if (channels.length === 0) throw new Error('App Server 没有登记任何 Renderer 业务 channel');
  const sessionFor = createRendererRequestSessions(input.gateway);

  for (const channel of channels) {
    ipc.handle(channel, async (event, ...args) => {
      assertCurrentMainFrame(event, readMainWindow());
      const controller = new AbortController();
      const sender = event.sender;
      const rendererSessionId = sessionFor(sender);
      const abort = (): void => controller.abort();
      sender.once('did-start-navigation', abort);
      sender.once('render-process-gone', abort);
      sender.once('destroyed', abort);
      try {
        return await input.gateway.invoke(channel, args, { signal: controller.signal, rendererSessionId });
      } finally {
        removeAbortListeners(sender, abort);
      }
    });
  }
  return channels;
}

/** 每次主文档加载拥有独立身份；旧窗口的延迟清理不能释放重载后新建的视图。 */
function createRendererRequestSessions(gateway: BackendRendererRequestRpcGatewayPort) {
  const sessions = new Map<WebContents, string>();
  const logger = new Logger('RendererRequestSessions');
  return (sender: WebContents): string => {
    const existing = sessions.get(sender);
    if (existing) return existing;
    const id = randomUUID();
    sessions.set(sender, id);
    const navigation = (_event: Electron.Event, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) release();
    };
    const release = () => {
      sessions.delete(sender);
      sender.removeListener('did-start-navigation', navigation);
      sender.removeListener('render-process-gone', release);
      sender.removeListener('destroyed', release);
      void gateway.releaseRendererSession(id).catch(error => logger.error('释放 Renderer 会话失败', { rendererSessionId: id, error }));
    };
    sender.on('did-start-navigation', navigation);
    sender.once('render-process-gone', release);
    sender.once('destroyed', release);
    return id;
  };
}

function assertCurrentMainFrame(
  event: IpcMainInvokeEvent,
  mainWindow: BrowserWindow | null,
): void {
  if (!mainWindow
    || mainWindow.isDestroyed()
    || event.sender !== mainWindow.webContents
    || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('拒绝非当前主窗口 main frame 的 Backend IPC 请求');
  }
}

function removeAbortListeners(sender: WebContents, listener: () => void): void {
  sender.removeListener('did-start-navigation', listener);
  sender.removeListener('render-process-gone', listener);
  sender.removeListener('destroyed', listener);
}
