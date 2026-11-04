import { computed } from 'vue';
import type { CanvasCamera, CanvasEdge, CanvasEdgeId, CanvasEndpoint, CanvasPatch, CanvasPoint } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasConnectionKernel } from '../definitions/canvasConnections';
import { buildCanvasConnectionReversal } from '../functions/buildCanvasConnectionReversal';
import { createCanvasConnectionState } from '../store/createCanvasConnectionState';
import { createCanvasEndpointGesture } from './createCanvasEndpointGesture';
import { canvasConnectionToolbarPosition } from '../functions/canvasConnectionToolbarPosition';
import { createCanvasConnectionLabelPreview } from './createCanvasConnectionLabelPreview';

export function createCanvasConnectionEditing(session: CanvasDocumentSession, kernel: CanvasConnectionKernel, options: { finishText(): Promise<boolean>; createText(point: CanvasPoint, from: CanvasEndpoint): Promise<void>; clearCards(): void; report(failure: unknown): void; readDisplayVersion?(): number }) {
  const state = createCanvasConnectionState();
  let renewal: ReturnType<typeof setInterval> | null = null;
  let pendingLabel: Promise<boolean> | null = null;
  const selected = computed(() => session.state.snapshot.value?.elements.find((element): element is CanvasEdge => element.id === state.selectedId.value && element.type === 'edge') ?? null);
  const labelPreview = createCanvasConnectionLabelPreview(id => session.state.snapshot.value?.elements.find((element): element is CanvasEdge => element.type === 'edge' && element.id === id) ?? null);
  const releaseLabel = async () => { if (renewal) clearInterval(renewal); renewal = null; const id = state.label.value?.edge.id; if (id) await session.protect(id, [], 'line-label'); };
  async function patch(edge: CanvasEdge, value: CanvasPatch) {
    if (edge.locked && value.locked !== false) throw new Error('请先解锁这条连线');
    await session.commit([{ op: 'update', id: edge.id, baseRevision: edge.revision, patch: value }]);
  }
  async function saveLabel(): Promise<boolean> {
    if (pendingLabel) return pendingLabel;
    const draft = state.label.value; if (!draft) return true;
    pendingLabel = (async () => {
      try {
        if (draft.value !== draft.edge.label) await patch(draft.edge, { label: draft.value });
        if (state.label.value?.identity !== draft.identity) return true;
        await releaseLabel(); state.endLabel(); return true;
      }
      catch (failure) { options.report(failure); return false; }
    })();
    try { return await pendingLabel; } finally { pendingLabel = null; }
  }
  const gesture = createCanvasEndpointGesture({ session, kernel, state, report: options.report, createText: options.createText });
  return { state, selected, patch, saveLabel, labelPreview, labelPoint: (id: CanvasEdgeId) => { void options.readDisplayVersion?.(); return kernel.readEdgeGeometry(id)?.midpoint ?? null; }, geometry: () => { void options.readDisplayVersion?.(); void session.state.snapshot.value; return selected.value ? kernel.readEdgeGeometry(selected.value.id) : null; },
    toolbarPosition(input: { readonly geometry: NonNullable<ReturnType<CanvasConnectionKernel['readEdgeGeometry']>>; readonly camera: CanvasCamera; readonly size: { readonly width: number; readonly height: number }; readonly viewport: { readonly width: number; readonly height: number } }) {
      const project = (point: CanvasPoint) => ({ x: input.camera.x + point.x * input.camera.zoom, y: input.camera.y + point.y * input.camera.zoom });
      const midpoint = project(input.geometry.midpoint), cards = session.state.snapshot.value?.elements.flatMap(card => card.type === 'edge' ? [] : [{ ...project(card), width: card.width * input.camera.zoom, height: card.height * input.camera.zoom }]) ?? [];
      return canvasConnectionToolbarPosition({ ...input, midpoint, cards, line: input.geometry.points.map(project), label: selected.value?.label ? { x: midpoint.x - 100, y: midpoint.y - 12, width: 200, height: 24 } : null });
    },
    async select(id: CanvasEdgeId | null) {
      if (!(await options.finishText()) || !(await saveLabel())) return;
      state.select(id); kernel.setSelectedEdge(id); if (id) options.clearCards();
    },
    endpoint(which: 'from' | 'to'): CanvasEndpoint | null { return selected.value?.[which] ?? null; },
    async reverse() {
      if (!(await saveLabel())) return;
      const edge = selected.value;
      if (edge) await session.commit([buildCanvasConnectionReversal(edge)]);
    },
    async beginLabel() {
      const edge = selected.value; if (!edge || edge.locked || state.label.value) return;
      await session.protect(edge.id, ['label'], 'line-label'); state.beginLabel(edge);
      renewal = setInterval(() => { void session.protect(edge.id, ['label'], 'line-label').catch(options.report); }, 2000);
    },
    async remove() { if (selected.value?.locked) throw new Error('请先解锁这条连线'); if (!(await saveLabel())) return; const edge = selected.value; if (!edge) return; await session.commit([{ op: 'delete', id: edge.id, baseRevision: edge.revision }]); state.select(null); kernel.setSelectedEdge(null); },
    cancelLabel() { void releaseLabel().catch(options.report); state.endLabel(); },
    async suspend() { gesture.dispose(); await releaseLabel(); },
    start: gesture.start,
    dispose() { labelPreview.dispose(); gesture.dispose(); if (renewal) clearInterval(renewal); },
  };
}
