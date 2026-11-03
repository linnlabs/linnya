import { z } from 'zod';
import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { onRendererPluginPush } from '@plugin/renderer/pluginPushClient';
import { CANVAS_PLUGIN_ID, CanvasAgentGroupSchema, CanvasUndoResultSchema, CanvasApprovalResolutionSchema } from '@plugin/canvas/shared';
import type { CanvasAgentReviewPort } from '../features/agentReview';
async function request(channel: string, payload: unknown): Promise<unknown> {
  const result = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, channel, payload);
  if (!result.success) throw new Error(result.error);
  return result.data;
}
export function createCanvasAgentReviewPort(): CanvasAgentReviewPort {
  return {
    groups: async (documentId, viewId) => z.array(CanvasAgentGroupSchema).parse(await request('canvas:groups', { documentId, viewId })),
    withdraw: async input => CanvasUndoResultSchema.parse(await request('canvas:withdraw', input)),
    approve: async input => CanvasApprovalResolutionSchema.parse(await request('canvas:approval', input)),
    complete: async (documentId, groupId) => { await request('canvas:complete-group', { documentId, groupId }); },
    review: async (documentId, elementId, groupId) => { await request('canvas:review', { documentId, elementId, groupId }); },
    subscribe: (documentId, refresh) => onRendererPluginPush(CANVAS_PLUGIN_ID, 'canvas:groups-changed', payload => {
      const event = z.object({ documentId: z.string() }).parse(payload);
      if (!documentId || event.documentId === documentId) refresh();
    }),
  };
}
