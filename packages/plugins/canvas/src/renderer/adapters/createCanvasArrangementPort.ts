import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { CANVAS_PLUGIN_ID, CanvasArrangeRequestSchema, CanvasArrangeResultSchema, CanvasCancelArrangementRequestSchema } from '@plugin/canvas/shared';
import type { CanvasArrangementPort } from '../features/layoutCommands';
export function createCanvasArrangementPort(): CanvasArrangementPort {
  return {
    async arrange(input) { const result = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, 'canvas:arrange', CanvasArrangeRequestSchema.parse(input)); if (!result.success) throw new Error(result.error); return CanvasArrangeResultSchema.parse(result.data); },
    async cancel(input) { const result = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, 'canvas:cancel-arrange', CanvasCancelArrangementRequestSchema.parse(input)); if (!result.success) throw new Error(result.error); },
  };
}
