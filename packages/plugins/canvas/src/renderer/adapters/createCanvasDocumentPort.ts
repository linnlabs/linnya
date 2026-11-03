import { onRendererPluginPush } from '@plugin/renderer/pluginPushClient';
import { z } from 'zod';
import { CANVAS_PLUGIN_ID, CANVAS_CHANGED_CHANNEL, CanvasSnapshotSchema, CanvasSynchronizationSchema, CanvasCommitResultSchema, CanvasUndoResultSchema } from '@plugin/canvas/shared';
import type { CanvasDocumentPort } from '../features/canvasDocument';
import { requestCanvasIpc as request, requestCanvasMutation } from './requestCanvasIpc';
const changedEvent = z.object({ documentId: z.string(), sequence: z.number().int().nonnegative() });

export function createCanvasDocumentPort(): CanvasDocumentPort {
  return {
    read: async (documentId, viewId) => CanvasSnapshotSchema.parse(await request('canvas:read', { documentId, viewId })),
    changes: async (documentId, afterSequence) => CanvasSynchronizationSchema.parse(await request('canvas:changes', { documentId, afterSequence })),
    commit: input => requestCanvasMutation('canvas:commit', input, value => CanvasCommitResultSchema.parse(value)),
    editing: async input => { await request('canvas:editing', input); },
    undo: input => requestCanvasMutation('canvas:undo', input, value => CanvasUndoResultSchema.parse(value)),
    close: async (documentId, viewId) => { await request('canvas:close', { documentId, viewId }); },
    subscribe: callback => onRendererPluginPush(CANVAS_PLUGIN_ID, CANVAS_CHANGED_CHANNEL, payload => {
      callback(changedEvent.parse(payload));
    }),
  };
}
