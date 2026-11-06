import { z } from 'zod';
import { onRendererPluginPush } from '@plugin/renderer/pluginPushClient';
import {
  CANVAS_PLUGIN_ID,
  CanvasAgentGroupSchema,
  CanvasUndoResultSchema,
  CanvasApprovalResolutionSchema,
} from '@plugin/canvas/shared';
import type { CanvasAgentReviewPort } from '../features/agentReview';
import { requestCanvasIpc as request, requestCanvasMutation } from './requestCanvasIpc';
export function createCanvasAgentReviewPort(): CanvasAgentReviewPort {
  return {
    groups: async (documentId, viewId) =>
      z.array(CanvasAgentGroupSchema).parse(await request('canvas:groups', { documentId, viewId })),
    withdraw: input =>
      requestCanvasMutation('canvas:withdraw', input, value => CanvasUndoResultSchema.parse(value)),
    approve: input =>
      requestCanvasMutation('canvas:approval', input, value =>
        CanvasApprovalResolutionSchema.parse(value)
      ),
    complete: async (documentId, groupId) => {
      await request('canvas:complete-group', { documentId, groupId });
    },
    review: async (documentId, elementId, groupId) => {
      await request('canvas:review', { documentId, elementId, groupId });
    },
    subscribe: (documentId, refresh) =>
      onRendererPluginPush(CANVAS_PLUGIN_ID, 'canvas:groups-changed', payload => {
        const event = z.object({ documentId: z.string() }).parse(payload);
        if (!documentId || event.documentId === documentId) refresh();
      }),
  };
}
