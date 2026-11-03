import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { CANVAS_PLUGIN_ID } from '@plugin/canvas/shared';
import { CanvasDeliveryUnknownError } from '../features/canvasDocument';
export async function requestCanvasIpc(channel: string, payload: unknown): Promise<unknown> {
  const result = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, channel, payload);
  if (result.success) return result.data;
  if (result.failureKind === 'delivery_unknown') throw new CanvasDeliveryUnknownError(result.error);
  throw new Error(result.error);
}
export async function requestCanvasMutation<T>(channel: string, payload: unknown, decode: (value: unknown) => T): Promise<T> {
  const response = await requestCanvasIpc(channel, payload);
  try { return decode(response); }
  catch { throw new CanvasDeliveryUnknownError('提交回执无法验证，请用原请求确认结果'); }
}
