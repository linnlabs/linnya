import { invokeRendererPluginIpc } from '@plugin/renderer/pluginIpcClient';
import { CANVAS_PLUGIN_ID } from '@plugin/canvas/shared';
import { CanvasDeliveryUnknownError } from '../features/canvasDocument';
import { CanvasUserError, canvasText } from '../features/localization';
import { isCanvasUserFailureCode } from '@plugin/canvas/shared';
export async function requestCanvasIpc(channel: string, payload: unknown): Promise<unknown> {
  const result = await invokeRendererPluginIpc<unknown>(CANVAS_PLUGIN_ID, channel, payload);
  if (result.success) return result.data;
  if (result.failureKind === 'delivery_unknown') {
    console.warn('[Canvas] 插件调用送达未知', channel, result.error);
    throw new CanvasDeliveryUnknownError(canvasText('canvas.error.deliveryUnknown'), result.error);
  }
  if (isCanvasUserFailureCode(result.error))
    throw new CanvasUserError(canvasText(`canvas.failure.${result.error}`));
  if (result.userMessage?.fallback)
    throw new CanvasUserError(result.userMessage.fallback, result.error);
  // 宿主原文（数据库、IPC 等）属于内部细节：交给 canvasUserMessage 记日志并给通用提示。
  throw new Error(result.error);
}
export async function requestCanvasMutation<T>(
  channel: string,
  payload: unknown,
  decode: (value: unknown) => T
): Promise<T> {
  const response = await requestCanvasIpc(channel, payload);
  try {
    return decode(response);
  } catch {
    throw new CanvasDeliveryUnknownError(canvasText('canvas.error.receiptUnverified'));
  }
}
