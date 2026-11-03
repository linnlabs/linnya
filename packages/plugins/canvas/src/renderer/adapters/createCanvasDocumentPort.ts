import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { onRendererPluginPush } from '@plugin/renderer/pluginPushClient';
import { z } from 'zod';
import { CANVAS_PLUGIN_ID, CANVAS_CHANGED_CHANNEL, CanvasSnapshotSchema, CanvasSynchronizationSchema, CanvasCommitResultSchema } from '@plugin/canvas/shared';
import type { CanvasDocumentPort } from '../features/canvasDocument';

async function request(channel: string, payload: unknown): Promise<unknown> {
  const result = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, channel, payload);
  if (!result.success) throw new Error(result.error);
  return result.data;
}
const changedEvent = z.object({ documentId: z.string(), sequence: z.number().int().nonnegative() });

export function createCanvasDocumentPort(): CanvasDocumentPort {
  return {
    read: async documentId => CanvasSnapshotSchema.parse(await request('canvas:read', { documentId })),
    changes: async (documentId, afterSequence) => CanvasSynchronizationSchema.parse(await request('canvas:changes', { documentId, afterSequence })),
    commit: async input => CanvasCommitResultSchema.parse(await request('canvas:commit', input)),
    editing: async input => { await request('canvas:editing', input); },
    subscribe: callback => onRendererPluginPush(CANVAS_PLUGIN_ID, CANVAS_CHANGED_CHANNEL, payload => {
      callback(changedEvent.parse(payload));
    }),
  };
}
