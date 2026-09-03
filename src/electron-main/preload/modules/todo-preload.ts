/**
 * @file src/electron-main/preload/modules/todo-preload.ts
 *
 * @description Todo 相关的 preload API。
 */

import type { IpcRenderer } from 'electron';
import type { AddTodoArgs, UpdateTodoArgs } from '../types';

export function buildTodoPreloadApi(ipcRenderer: IpcRenderer) {
  return {
    'todo:get-overview': (limit: number) => ipcRenderer.invoke('todo:get-overview', limit),
    'todo:get-for-project': (projectId: string) => ipcRenderer.invoke('todo:get-for-project', projectId),
    'todo:add': (payload: AddTodoArgs) => ipcRenderer.invoke('todo:add', payload),
    'todo:update': (args: UpdateTodoArgs) => ipcRenderer.invoke('todo:update', args),
    'todo:delete': (todoId: string) => ipcRenderer.invoke('todo:delete', todoId),
  };
}


