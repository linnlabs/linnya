import { shallowReadonly, shallowRef } from 'vue';
import type { CanvasCamera, CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasSurfaceState, CanvasViewportSize } from '../definitions/canvasSurface';

export function createCanvasSurfaceState(initialViewport: CanvasViewportSize): CanvasSurfaceState {
  const camera = shallowRef<CanvasCamera>({ x: 0, y: 0, zoom: 1 });
  const error = shallowRef<string | null>(null);
  const renderNotice = shallowRef<string | null>(null);
  const hoveredId = shallowRef<CanvasCardId | null>(null);
  const detailId = shallowRef<CanvasCardId | null>(null);
  const displayVersion = shallowRef(0);
  const viewport = shallowRef(initialViewport);
  const context = shallowRef<Parameters<CanvasSurfaceState['setContext']>[0]>(null);
  return {
    camera: shallowReadonly(camera),
    error: shallowReadonly(error),
    context: shallowReadonly(context),
    renderNotice: shallowReadonly(renderNotice),
    hoveredId: shallowReadonly(hoveredId),
    detailId: shallowReadonly(detailId),
    displayVersion: shallowReadonly(displayVersion),
    viewport: shallowReadonly(viewport),
    setViewport(value) {
      viewport.value = value;
    },
    advanceDisplay() {
      displayVersion.value += 1;
    },
    setDetailVisible(id, visible) {
      if (visible) detailId.value = id;
      else if (detailId.value === id) detailId.value = null;
    },
    setCamera(value) {
      camera.value = value;
    },
    fail(message) {
      error.value = message;
    },
    clearFailure() {
      error.value = null;
    },
    setContext(value) {
      context.value = value;
    },
    setRenderNotice(message) {
      renderNotice.value = message;
    },
    setHovered(value) {
      hoveredId.value = value;
    },
  };
}
