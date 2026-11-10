import { onRendererPluginPush } from '@plugin/renderer/pluginPushClient';
import {
  CANVAS_PLUGIN_ID,
  CANVAS_CHANGED_CHANNEL,
  CanvasChangedEventSchema,
  CanvasSnapshotSchema,
  CanvasSynchronizationSchema,
  CanvasCommitResultSchema,
  CanvasUndoResultSchema,
} from '@plugin/canvas/shared';
import type { CanvasDocumentPort } from '../features/canvasDocument';
import { requestCanvasIpc as request, requestCanvasMutation } from './requestCanvasIpc';

export function createCanvasDocumentPort(): CanvasDocumentPort {
  return {
    read: async (documentId, viewId) =>
      CanvasSnapshotSchema.parse(await request('canvas:read', { documentId, viewId })),
    changes: async (documentId, afterSequence) => {
      const response = await request('canvas:changes', { documentId, afterSequence });
      // 通道解码和插件DTO校验都可能遍历一整批正文；不能在同一微任务链连续占住主线程。
      // 校验仍是端口返回前的必要步骤，调用方拿到的永远是已验证的完整响应。
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      return CanvasSynchronizationSchema.parse(response);
    },
    commit: input =>
      requestCanvasMutation('canvas:commit', input, value => CanvasCommitResultSchema.parse(value)),
    editing: async input => {
      await request('canvas:editing', input);
    },
    undo: input =>
      requestCanvasMutation('canvas:undo', input, value => CanvasUndoResultSchema.parse(value)),
    close: async (documentId, viewId) => {
      await request('canvas:close', { documentId, viewId });
    },
    subscribe: callback =>
      onRendererPluginPush(CANVAS_PLUGIN_ID, CANVAS_CHANGED_CHANNEL, payload => {
        callback(CanvasChangedEventSchema.parse(payload));
      }),
  };
}
