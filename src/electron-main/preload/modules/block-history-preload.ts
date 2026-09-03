/**
 * @file src/electron-main/preload/modules/block-history-preload.ts
 *
 * @description 块级历史（BlockHistory）相关的 preload API。
 */

import type { IpcRenderer } from 'electron';
import type {
  BlockHistoryListVersionsArgs,
  BlockHistoryGetVersionArgs,
  BlockHistoryCreateVersionArgs,
  BlockHistoryRestoreVersionArgs,
  BlockHistoryBlockScopedArgs,
  BlockHistoryDeleteVersionArgs,
} from '../types';

export function buildBlockHistoryPreloadApi(ipcRenderer: IpcRenderer) {
  return {
    'block-history:list-versions': (args: BlockHistoryListVersionsArgs) => ipcRenderer.invoke('block-history:list-versions', args),
    'block-history:get-version': (args: BlockHistoryGetVersionArgs) => ipcRenderer.invoke('block-history:get-version', args),
    'block-history:create-version': (args: BlockHistoryCreateVersionArgs) => ipcRenderer.invoke('block-history:create-version', args),
    'block-history:restore-version': (args: BlockHistoryRestoreVersionArgs) => ipcRenderer.invoke('block-history:restore-version', args),
    'block-history:get-latest-version': (args: BlockHistoryBlockScopedArgs) => ipcRenderer.invoke('block-history:get-latest-version', args),
    'block-history:get-version-count': (args: BlockHistoryBlockScopedArgs) => ipcRenderer.invoke('block-history:get-version-count', args),
    'block-history:delete-version': (args: BlockHistoryDeleteVersionArgs) => ipcRenderer.invoke('block-history:delete-version', args),
  };
}


