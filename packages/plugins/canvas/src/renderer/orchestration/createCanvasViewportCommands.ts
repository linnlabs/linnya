import type { CanvasCamera, CanvasCard, CanvasCardId, CanvasElement, CanvasElementId, CanvasEndpoint, CanvasRectangle } from '@plugin/canvas/shared';
import type { CanvasKernel } from '../kernel';
export function createCanvasViewportCommands(options: {
  readonly kernel: Pick<CanvasKernel, 'canvas' | 'fit' | 'readCamera' | 'setCamera' | 'readEdgeGeometry'>; readonly setCamera: (value: CanvasCamera) => void; readonly refresh: () => void;
  readonly cards: () => readonly CanvasCard[]; readonly selected: () => readonly CanvasCard[]; readonly elements: () => readonly CanvasElement[];
  readonly select: (ids: readonly CanvasCardId[]) => Promise<void>; readonly selectEdge: (id: Extract<CanvasElement, { type: 'edge' }>['id']) => Promise<void>;
}) {
  const update = () => { options.setCamera(options.kernel.readCamera()); options.refresh(); };
  const locate = (ids: readonly CanvasElementId[]) => {
    const selected = new Set(ids), rectangles = options.elements().filter(element => selected.has(element.id)).flatMap<CanvasRectangle>(element => {
      if (element.type !== 'edge') return [element];
      return options.kernel.readEdgeGeometry(element.id)?.points.map(point => ({ ...point, width: 1, height: 1 })) ?? [];
    });
    if (!rectangles.length) return; options.kernel.fit(rectangles); update();
  };
  return { locate,
    async selectContext(input: { readonly id: CanvasCardId | null; readonly edgeId?: Extract<CanvasElement, { type: 'edge' }>['id'] | null }) {
      if (input.edgeId) await options.selectEdge(input.edgeId);
      else if (input.id && !options.selected().some(card => card.id === input.id)) await options.select([input.id]);
      else if (!input.id) await options.select([]);
    },
    locateEndpoint(endpoint: CanvasEndpoint | null) { if (!endpoint) return; if (endpoint.kind === 'card') { locate([endpoint.cardId]); return; }
      const camera = options.kernel.readCamera(); options.kernel.setCamera({ ...camera, x: options.kernel.canvas.clientWidth / 2 - endpoint.x * camera.zoom, y: options.kernel.canvas.clientHeight / 2 - endpoint.y * camera.zoom }); update(); },
    zoom(value: number) { options.kernel.setCamera({ ...options.kernel.readCamera(), zoom: value }); update(); },
    fit(onlySelected = false) { const cards = onlySelected ? options.selected() : options.cards(); if (cards.length) { options.kernel.fit(cards); update(); } },
    focus: () => options.kernel.canvas.focus(),
    async focusElements(ids: readonly CanvasElementId[]) {
      const id = ids[0], element = options.elements().find(element => element.id === id);
      if (!element) return;
      if (element.type === 'edge') await options.selectEdge(element.id); else await options.select([element.id]);
      locate(ids);
    },
  };
}
