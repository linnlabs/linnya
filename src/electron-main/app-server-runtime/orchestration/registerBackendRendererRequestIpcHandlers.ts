import {
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
  type WebContents,
} from 'electron';

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

  for (const channel of channels) {
    ipc.handle(channel, async (event, ...args) => {
      assertCurrentMainFrame(event, readMainWindow());
      const controller = new AbortController();
      const sender = event.sender;
      const abort = (): void => controller.abort();
      sender.once('did-start-navigation', abort);
      sender.once('render-process-gone', abort);
      sender.once('destroyed', abort);
      try {
        return await input.gateway.invoke(channel, args, { signal: controller.signal });
      } finally {
        removeAbortListeners(sender, abort);
      }
    });
  }
  return channels;
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
