import { onRendererPluginPush } from '@plugin/renderer/pluginPushClient';
import { CANVAS_PLUGIN_ID, CANVAS_HISTORY_BUDGET_CHANNEL, CanvasSnapshotSchema, CanvasVersionBudgetStatusSchema, type CanvasVersionBudgetStatus } from '@plugin/canvas/shared';
import { requestCanvasIpc } from './requestCanvasIpc';
export function createCanvasHistoryPort() {
  return {
    read: async (documentId: string, versionId: string) => CanvasSnapshotSchema.parse(await requestCanvasIpc('canvas:history-preview', { documentId, versionId })),
    readBudget: async (documentId: string) => CanvasVersionBudgetStatusSchema.parse(await requestCanvasIpc('canvas:history-budget', { documentId })),
    subscribeBudget: (listener: (status: CanvasVersionBudgetStatus) => void) => onRendererPluginPush(CANVAS_PLUGIN_ID, CANVAS_HISTORY_BUDGET_CHANNEL, payload => listener(CanvasVersionBudgetStatusSchema.parse(payload))),
  };
}
