import type { CanvasEdgeId, CanvasPoint } from '@plugin/canvas/shared';
import type { CanvasKernel } from '../kernel';

/** 卡身双击由kernel处理；表面只补空白新建与线标签进入，不重复打开正文。 */
export function installCanvasSurfaceDoubleClick(options: {
  readonly host: HTMLElement;
  readonly kernel: Pick<CanvasKernel, 'canvas' | 'screenToWorld' | 'hitTest' | 'hitTestEdge'>;
  readonly readonly: () => boolean;
  readonly create: (point: CanvasPoint) => Promise<void>;
  readonly label: (id: CanvasEdgeId) => Promise<void>;
  readonly report: (error: unknown) => void;
}) {
  const doubleClick = (event: MouseEvent) => {
    if (event.target !== options.kernel.canvas || options.readonly()) return;
    const box = options.kernel.canvas.getBoundingClientRect(),
      point = options.kernel.screenToWorld({
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
    if (options.kernel.hitTest(point)) return;
    const edge = options.kernel.hitTestEdge(point);
    void (edge ? options.label(edge.id) : options.create(point)).catch(options.report);
  };
  options.host.addEventListener('dblclick', doubleClick);
  return () => options.host.removeEventListener('dblclick', doubleClick);
}
