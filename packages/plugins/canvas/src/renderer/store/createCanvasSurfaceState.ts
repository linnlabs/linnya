import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasCamera, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasSurfaceState } from '../definitions/canvasSurface';

export function createCanvasSurfaceState(): CanvasSurfaceState {
  const camera = shallowRef<CanvasCamera>({ x: 0, y: 0, zoom: 1 });
  const error = shallowRef<string | null>(null);
  const renderNotice = shallowRef<string | null>(null);
  const hoveredId = shallowRef<CanvasCardId | null>(null);
  const context = shallowRef<Parameters<CanvasSurfaceState['setContext']>[0]>(null);
  return { camera: shallowReadonly(camera), error: shallowReadonly(error), context: shallowReadonly(context), renderNotice: shallowReadonly(renderNotice), hoveredId: shallowReadonly(hoveredId),
    setCamera(value) { camera.value = value; }, fail(message) { error.value = message; }, clearFailure() { error.value = null; }, setContext(value) { context.value = value; }, setRenderNotice(message) { renderNotice.value = message; }, setHovered(value) { hoveredId.value = value; } };
}
