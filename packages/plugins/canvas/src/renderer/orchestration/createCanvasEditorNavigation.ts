import type { EmbeddedMarkdownNavigationIntent } from '@plugin/renderer/embeddedMarkdownEditor';
import { canvasPanCamera, canvasZoomCamera, type CanvasKernel, type CanvasKernelIntent } from '../kernel';

export function createCanvasEditorNavigation(kernel: Pick<CanvasKernel, 'canvas' | 'readCamera' | 'setCamera'>, changed: (intent: Extract<CanvasKernelIntent, { kind: 'camera' }>) => void) {
  return (intent: EmbeddedMarkdownNavigationIntent) => {
    const current = kernel.readCamera(), bounds = kernel.canvas.getBoundingClientRect();
    const camera = intent.kind === 'pan' ? canvasPanCamera(current, intent.dx, intent.dy) : canvasZoomCamera(current, { x: intent.clientX - bounds.left, y: intent.clientY - bounds.top }, intent.deltaY);
    kernel.setCamera(camera); changed({ kind: 'camera', camera });
  };
}
