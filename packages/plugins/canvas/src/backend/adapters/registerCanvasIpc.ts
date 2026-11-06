import { z } from 'zod';
import type { BackendPluginIpcHandlerRegistrar } from '@plugin/backend/pluginContribution';
import { assertPluginRuntimeEnabled } from '@plugin/backend/pluginRuntime';
import {
  readBackendPluginRendererContext,
  type BackendPluginRendererContext,
} from '@plugin/backend/pluginIpcRuntime';
import {
  CANVAS_PLUGIN_ID,
  CanvasChangesRequestSchema,
  CanvasEditingRequestSchema,
  CanvasReadRequestSchema,
  CanvasUndoRequestSchema,
  CanvasCloseRequestSchema,
  CanvasGroupsRequestSchema,
  CanvasCloseGroupRequestSchema,
  CanvasReviewRequestSchema,
  CanvasWithdrawGroupRequestSchema,
  CanvasResolveApprovalRequestSchema,
  CanvasReadImageRequestSchema,
  CanvasHistoryPreviewRequestSchema,
  CanvasHistoryBudgetRequestSchema,
} from '../../shared';
import { Logger } from '@plugin/backend/workspaceRuntime';
import { projectCanvasBusinessFailure } from './projectCanvasCliFailure';
import {
  readCanvasClipboard,
  readCanvasSelectionContext,
} from '../orchestration/readCanvasSelectionContext';
import type { CanvasIpcServices } from '../definitions/canvasIpcServices';
import type { CanvasDatabase } from '../definitions/canvasDatabase';

export const CANVAS_IPC_CHANNELS = [
  'canvas:read',
  'canvas:commit',
  'canvas:changes',
  'canvas:editing',
  'canvas:undo',
  'canvas:close',
  'canvas:groups',
  'canvas:complete-group',
  'canvas:review',
  'canvas:withdraw',
  'canvas:approval',
  'canvas:import-image',
  'canvas:prepare-image',
  'canvas:read-image',
  'canvas:context',
  'canvas:clipboard',
  'canvas:arrange',
  'canvas:cancel-arrange',
  'canvas:history-preview',
  'canvas:history-budget',
] as const;

export function registerCanvasIpc(input: {
  readonly database: CanvasDatabase;
  readonly services: () => CanvasIpcServices;
  readonly register: BackendPluginIpcHandlerRegistrar;
}): void {
  const { database, register, services } = input;
  const logger = new Logger('CanvasIpc');
  const handlers = {
    'canvas:read': (payload: unknown, context?: BackendPluginRendererContext) => {
      const input = CanvasReadRequestSchema.parse(payload);
      return services().runtime.read(input.documentId, undefined, input.viewId, context);
    },
    'canvas:commit': (payload: unknown) => services().runtime.commit(payload),
    'canvas:changes': (payload: unknown) => {
      const input = CanvasChangesRequestSchema.parse(payload);
      return services().runtime.changes(input.documentId, input.afterSequence);
    },
    'canvas:editing': (payload: unknown) => {
      services().runtime.protect(CanvasEditingRequestSchema.parse(payload));
      return null;
    },
    'canvas:undo': (payload: unknown) =>
      services().runtime.undo(CanvasUndoRequestSchema.parse(payload)),
    'canvas:close': (payload: unknown) => {
      const input = CanvasCloseRequestSchema.parse(payload);
      services().arrangement.close(input.documentId, input.viewId);
      services().runtime.close(input.documentId, input.viewId);
      return null;
    },
    'canvas:groups': (payload: unknown) => {
      const input = CanvasGroupsRequestSchema.parse(payload);
      services().runtime.assertDocument(input.documentId);
      return services().runtime.editing.listGroups(input.documentId, Date.now(), input.viewId);
    },
    'canvas:complete-group': (payload: unknown) => {
      const input = CanvasCloseGroupRequestSchema.parse(payload);
      services().runtime.assertDocument(input.documentId);
      services().runtime.editing.closeGroup(input);
      return null;
    },
    'canvas:review': (payload: unknown) => {
      const input = CanvasReviewRequestSchema.parse(payload);
      services().runtime.assertDocument(input.documentId);
      services().runtime.editing.reviewElement(input);
      return null;
    },
    'canvas:withdraw': (payload: unknown) => {
      const input = CanvasWithdrawGroupRequestSchema.parse(payload);
      services().runtime.assertDocument(input.documentId);
      return services().runtime.editing.withdraw(input, Date.now());
    },
    'canvas:approval': (payload: unknown) => {
      const input = CanvasResolveApprovalRequestSchema.parse(payload);
      services().runtime.assertDocument(input.documentId);
      return services().runtime.editing.resolveApproval(input, Date.now());
    },
    'canvas:import-image': (payload: unknown) => services().images.importImage(payload),
    'canvas:prepare-image': (payload: unknown) => services().images.prepareImage(payload),
    'canvas:read-image': (payload: unknown) =>
      services().images.readImage(CanvasReadImageRequestSchema.parse(payload)),
    'canvas:arrange': (payload: unknown) => {
      return services().arrangement.arrange(payload);
    },
    'canvas:cancel-arrange': (payload: unknown) => {
      services().arrangement.cancel(payload);
      return null;
    },
    'canvas:clipboard': (payload: unknown) => readCanvasClipboard(database, payload),
    'canvas:history-preview': (payload: unknown) => {
      const value = CanvasHistoryPreviewRequestSchema.parse(payload);
      return services().runtime.history.preview(value.documentId, value.versionId);
    },
    'canvas:history-budget': (payload: unknown) => {
      const value = CanvasHistoryBudgetRequestSchema.parse(payload);
      return services().runtime.history.budget(value.documentId);
    },
    'canvas:context': (payload: unknown) => readCanvasSelectionContext(database, payload),
  };
  for (const channel of CANVAS_IPC_CHANNELS) {
    register(CANVAS_PLUGIN_ID, channel, async (event, payload) => {
      assertPluginRuntimeEnabled({
        pluginId: CANVAS_PLUGIN_ID,
        pluginName: 'Canvas',
        action: '操作画布',
      });
      try {
        const context = readBackendPluginRendererContext(event);
        context?.signal.throwIfAborted();
        return { success: true, data: await handlers[channel](payload, context) };
      } catch (error) {
        const business = projectCanvasBusinessFailure(error);
        const code =
          error instanceof z.ZodError || business
            ? business?.code === 'document_missing'
              ? 'missing'
              : 'validation'
            : 'crash';
        if (code === 'crash') logger.error('Canvas IPC 处理失败', { channel, error });
        return {
          success: false,
          error:
            business?.message ??
            (error instanceof z.ZodError
              ? '画布操作字段无效，请刷新后重试。'
              : '画布操作失败，详细原因已记录到日志。'),
          diagnostic: { code, reason: business?.code, pluginId: CANVAS_PLUGIN_ID, channel },
        };
      }
    });
  }
}
