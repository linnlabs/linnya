import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasCamera } from '@plugin/canvas/shared';
import type { CanvasSurfaceState } from '../definitions/canvasSurface';

export function createCanvasSurfaceState(): CanvasSurfaceState {
  const camera = shallowRef<CanvasCamera>({ x: 0, y: 0, zoom: 1 });
  const error = shallowRef<string | null>(null);
  const context = shallowRef<Parameters<CanvasSurfaceState['setContext']>[0]>(null);
  return { camera: shallowReadonly(camera), error: shallowReadonly(error), context: shallowReadonly(context),
    setCamera(value) { camera.value = value; }, fail(message) { error.value = message; }, setContext(value) { context.value = value; } };
}
