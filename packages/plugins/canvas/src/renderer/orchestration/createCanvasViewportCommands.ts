import type { CanvasCamera, CanvasCard, CanvasCardId, CanvasElement, CanvasElementId, CanvasEndpoint, CanvasRectangle } from '@plugin/canvas/shared';
import type { CanvasKernel } from '../kernel';
import { canvasFitCamera } from '../kernel/navigation';
import { canvasRevealCardCamera } from '../functions/canvasRevealCardCamera';
import { canvasFocusCardIds } from '../functions/canvasFocusCardIds';
export function createCanvasViewportCommands(options: {
  readonly kernel: Pick<CanvasKernel, 'canvas' | 'fit' | 'readCamera' | 'setCamera' | 'readEdgeGeometry' | 'finishTransitions' | 'animateCamera'>; readonly setCamera: (value: CanvasCamera) => void; readonly refresh: () => void;
  readonly cards: () => readonly CanvasCard[]; readonly selected: () => readonly CanvasCard[]; readonly elements: () => readonly CanvasElement[];
  readonly select: (ids: readonly CanvasCardId[]) => Promise<boolean>; readonly selectEdge: (id: Extract<CanvasElement, { type: 'edge' }>['id']) => Promise<boolean>;
}) {
  const update = () => { options.setCamera(options.kernel.readCamera()); options.refresh(); };
  const fly = (rectangles: readonly CanvasRectangle[]) => { const camera = canvasFitCamera(rectangles, { width: options.kernel.canvas.clientWidth, height: options.kernel.canvas.clientHeight }); if (camera) { options.kernel.animateCamera(camera, 320); update(); } };
  const locate = (ids: readonly CanvasElementId[]) => {
    options.kernel.finishTransitions(canvasFocusCardIds(options.elements(), ids));
    const selected = new Set(ids), rectangles = options.elements().filter(element => selected.has(element.id)).flatMap<CanvasRectangle>(element => {
      if (element.type !== 'edge') return [element];
      return options.kernel.readEdgeGeometry(element.id)?.points.map(point => ({ ...point, width: 1, height: 1 })) ?? [];
    });
    fly(rectangles);
  };
  return { locate,
    reveal(id: CanvasCardId) { const card = options.cards().find(candidate => candidate.id === id); if (!card) return; options.kernel.finishTransitions([id]); options.kernel.setCamera(canvasRevealCardCamera({ card, camera: options.kernel.readCamera(), width: options.kernel.canvas.clientWidth, height: options.kernel.canvas.clientHeight })); update(); },
    async selectContext(input: { readonly id: CanvasCardId | null; readonly edgeId?: Extract<CanvasElement, { type: 'edge' }>['id'] | null }) {
      if (input.edgeId) return options.selectEdge(input.edgeId);
      if (input.id && !options.selected().some(card => card.id === input.id)) return options.select([input.id]);
      return input.id ? true : options.select([]);
    },
    locateEndpoint(endpoint: CanvasEndpoint | null) { if (!endpoint) return; if (endpoint.kind === 'card') { locate([endpoint.cardId]); return; }
      const camera = options.kernel.readCamera(); options.kernel.animateCamera({ ...camera, x: options.kernel.canvas.clientWidth / 2 - endpoint.x * camera.zoom, y: options.kernel.canvas.clientHeight / 2 - endpoint.y * camera.zoom }, 320); update(); },
    zoom(value: number) { options.kernel.setCamera({ ...options.kernel.readCamera(), zoom: value }); update(); },
    fit(onlySelected = false) { const cards = onlySelected ? options.selected() : options.cards(); if (cards.length) { options.kernel.finishTransitions(cards.map(card => card.id)); options.kernel.fit(cards); update(); } },
    focus: () => options.kernel.canvas.focus(),
    async focusRectangle(bounds: CanvasRectangle, ids: readonly CanvasCardId[] = []) { if (await options.select(ids)) { options.kernel.finishTransitions(ids); fly([bounds]); } },
    async focusElements(ids: readonly CanvasElementId[]) {
      const id = ids[0], element = options.elements().find(element => element.id === id);
      if (!element) return;
      const selected = element.type === 'edge' ? await options.selectEdge(element.id) : await options.select([element.id]);
      if (selected) locate(ids);
    },
  };
}
