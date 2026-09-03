/**
 * @file src/electron-main/preload/modules/common-ipc.ts
 *
 * @description
 * 通用 IPC 透传能力（send / invoke / on / removeAllListeners）。
 *
 * 注意：
 * - 必须使用 `validChannels` 白名单做 gate；
 * - 逻辑保持与历史 `preload.ts` 完全一致，仅拆分文件。
 */

import type { IpcRenderer, IpcRendererEvent } from 'electron';

export function buildCommonIpcApi(
  ipcRenderer: IpcRenderer,
  validChannels: readonly string[]
) {
  return {
    // --- 通用 IPC (如果需要，但不推荐直接暴露) ---
    send: (channel: string, data?: unknown) => {
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    invoke: (channel: string, data?: unknown) => {
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, data);
      }
    },
    on: (channel: string, func: (...args: unknown[]) => void) => {
      if (validChannels.includes(channel)) {
        // 为了安全，移除监听器时也应该包装一下
        const subscription = (_event: IpcRendererEvent, ...args: unknown[]) => func(...args);
        ipcRenderer.on(channel, subscription);
        return () => ipcRenderer.removeListener(channel, subscription);
      }
    },
    removeAllListeners: (channel: string) => {
      if (validChannels.includes(channel)) {
        ipcRenderer.removeAllListeners(channel);
      }
    },
  };
}

