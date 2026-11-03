import { z } from 'zod';
import type { BackendPluginIpcHandlerRegistrar } from '@plugin/backend/pluginContribution';
import { assertPluginRuntimeEnabled } from '@plugin/backend/pluginRuntime';
import {
  CANVAS_PLUGIN_ID, CanvasChangesRequestSchema, CanvasEditingRequestSchema, CanvasReadRequestSchema, CanvasUndoRequestSchema,
  CanvasCloseRequestSchema, CanvasGroupsRequestSchema, CanvasCloseGroupRequestSchema, CanvasReviewRequestSchema,
  CanvasWithdrawGroupRequestSchema, CanvasResolveApprovalRequestSchema,
  CanvasReadImageRequestSchema,
} from '../../shared';
import type { CanvasDocumentRuntime } from '../orchestration/createCanvasDocumentRuntime';
import { CanvasDocumentFailure } from '../features/canvasDocument';
import type { createCanvasImageRuntime } from '../orchestration/createCanvasImageRuntime';

export const CANVAS_IPC_CHANNELS = ['canvas:read', 'canvas:commit', 'canvas:changes', 'canvas:editing', 'canvas:undo', 'canvas:close',
  'canvas:groups', 'canvas:complete-group', 'canvas:review', 'canvas:withdraw', 'canvas:approval', 'canvas:import-image', 'canvas:read-image'] as const;

export function registerCanvasIpc(runtime: CanvasDocumentRuntime, images: ReturnType<typeof createCanvasImageRuntime>, register: BackendPluginIpcHandlerRegistrar): void {
  const handlers = {
    'canvas:read': (payload: unknown) => { const input = CanvasReadRequestSchema.parse(payload); return runtime.read(input.documentId, undefined, input.viewId); },
    'canvas:commit': (payload: unknown) => runtime.commit(payload),
    'canvas:changes': (payload: unknown) => { const input = CanvasChangesRequestSchema.parse(payload); return runtime.changes(input.documentId, input.afterSequence); },
    'canvas:editing': (payload: unknown) => { runtime.protect(CanvasEditingRequestSchema.parse(payload)); return null; },
    'canvas:undo': (payload: unknown) => runtime.undo(CanvasUndoRequestSchema.parse(payload)),
    'canvas:close': (payload: unknown) => { const input = CanvasCloseRequestSchema.parse(payload); runtime.close(input.documentId, input.viewId); return null; },
    'canvas:groups': (payload: unknown) => { const input = CanvasGroupsRequestSchema.parse(payload); runtime.read(input.documentId); return runtime.editing.listGroups(input.documentId, Date.now(), input.viewId); },
    'canvas:complete-group': (payload: unknown) => { const input = CanvasCloseGroupRequestSchema.parse(payload); runtime.read(input.documentId); runtime.editing.closeGroup(input); return null; },
    'canvas:review': (payload: unknown) => { const input = CanvasReviewRequestSchema.parse(payload); runtime.read(input.documentId); runtime.editing.reviewElement(input); return null; },
    'canvas:withdraw': (payload: unknown) => { const input = CanvasWithdrawGroupRequestSchema.parse(payload); runtime.read(input.documentId); return runtime.editing.withdraw(input, Date.now()); },
    'canvas:approval': (payload: unknown) => { const input = CanvasResolveApprovalRequestSchema.parse(payload); runtime.read(input.documentId); return runtime.editing.resolveApproval(input, Date.now()); },
    'canvas:import-image': (payload: unknown) => images.importImage(payload),
    'canvas:read-image': (payload: unknown) => images.readImage(CanvasReadImageRequestSchema.parse(payload)),
  };
  for (const channel of CANVAS_IPC_CHANNELS) {
    register(CANVAS_PLUGIN_ID, channel, async (_event, payload) => {
      assertPluginRuntimeEnabled({ pluginId: CANVAS_PLUGIN_ID, pluginName: 'Canvas', action: '操作画布' });
      try { return { success: true, data: await handlers[channel](payload) }; }
      catch (error) {
        const code = error instanceof z.ZodError ? 'validation' : error instanceof CanvasDocumentFailure && error.code === 'document_missing' ? 'missing' : 'crash';
        return { success: false, error: error instanceof Error ? error.message : String(error), diagnostic: { code, pluginId: CANVAS_PLUGIN_ID, channel } };
      }
    });
  }
}
