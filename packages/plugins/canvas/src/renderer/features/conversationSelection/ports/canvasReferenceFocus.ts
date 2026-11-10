import type { CanvasReferenceFocus } from '../definitions/canvasSelectionReference';
import { canvasText } from '../../localization';
const handlers = new Map<string, Set<CanvasReferenceFocus>>();
const waiters = new Map<string, Set<(focus: CanvasReferenceFocus | null) => void>>();

/** 注册的是表面的定位能力，不保存选择或正文；窗口之间由各自模块实例隔离。 */
export function registerCanvasReferenceFocus(
  documentId: string,
  focus: CanvasReferenceFocus
): () => void {
  const documentHandlers = handlers.get(documentId) ?? new Set<CanvasReferenceFocus>();
  documentHandlers.add(focus);
  handlers.set(documentId, documentHandlers);
  for (const waiter of waiters.get(documentId) ?? []) waiter(focus);
  return () => {
    documentHandlers.delete(focus);
    if (!documentHandlers.size && handlers.get(documentId) === documentHandlers)
      handlers.delete(documentId);
  };
}
export async function focusCanvasReference(
  documentId: string,
  ids: Parameters<CanvasReferenceFocus>[0]
): Promise<void> {
  // 与文档历史动作一致，优先最近注册且仍存活的表面。
  const available = [...(handlers.get(documentId) ?? [])],
    current = available[available.length - 1];
  if (current) return current(ids);
  const focus = await new Promise<CanvasReferenceFocus | null>((resolve, reject) => {
    const waiting =
      waiters.get(documentId) ?? new Set<(focus: CanvasReferenceFocus | null) => void>();
    const receive = (value: CanvasReferenceFocus | null) => {
      clearTimeout(timer);
      waiting.delete(receive);
      if (!waiting.size) waiters.delete(documentId);
      resolve(value);
    };
    const timer = setTimeout(() => {
      waiting.delete(receive);
      if (!waiting.size) waiters.delete(documentId);
      reject(new Error(canvasText('canvas.error.locateNotReady')));
    }, 5000);
    waiting.add(receive);
    waiters.set(documentId, waiting);
  });
  if (!focus) throw new Error(canvasText('canvas.error.pluginDisabled'));
  await focus(ids);
}
export function clearCanvasReferenceFocus(): void {
  handlers.clear();
  for (const waiting of waiters.values()) for (const resolve of waiting) resolve(null);
  waiters.clear();
}
