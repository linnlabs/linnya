import { onRendererPluginPush } from '@plugin/renderer/pluginPushClient';
import { CANVAS_PLUGIN_ID, CANVAS_RESTORED_CHANNEL, CanvasRestoredMessageSchema } from '@plugin/canvas/shared';
import type { CanvasRestoredMessage } from '../definitions/canvasHistoryRestoration';
export function subscribeCanvasRestored(listener: (message: CanvasRestoredMessage) => void): () => void {
  return onRendererPluginPush(CANVAS_PLUGIN_ID, CANVAS_RESTORED_CHANNEL, payload => listener(CanvasRestoredMessageSchema.parse(payload)));
}
