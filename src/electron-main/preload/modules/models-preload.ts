/**
 * @file src/electron-main/preload/modules/models-preload.ts
 *
 * @description 模型管理相关的 preload API。
 */

import type { IpcRenderer } from 'electron';

export function buildModelsPreloadApi(ipcRenderer: IpcRenderer) {
  return {
    getModels: () => ipcRenderer.invoke('get-models'),
    updateModels: (diff: any) => ipcRenderer.invoke('update-models', diff),
  };
}


