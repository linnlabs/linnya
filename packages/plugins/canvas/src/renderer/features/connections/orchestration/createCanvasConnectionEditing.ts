import { computed } from 'vue';
import type { CanvasEdge, CanvasEdgeId, CanvasEndpoint, CanvasPatch } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import type {
  CanvasConnectionKernel,
  CanvasConnectionEditingOptions,
  CanvasConnectionToolbarInput,
} from '../definitions/canvasConnections';
import { buildCanvasConnectionReversal } from '../functions/buildCanvasConnectionReversal';
import { createCanvasConnectionState } from '../store/createCanvasConnectionState';
import { createCanvasEndpointGesture } from './createCanvasEndpointGesture';
import { projectCanvasConnectionToolbar } from '../functions/projectCanvasConnectionToolbar';
import { createCanvasConnectionLabelPreview } from './createCanvasConnectionLabelPreview';
import { createCanvasConnectionLabelEditing } from './createCanvasConnectionLabelEditing';

export function createCanvasConnectionEditing(
  session: CanvasDocumentSession,
  kernel: CanvasConnectionKernel,
  options: CanvasConnectionEditingOptions
) {
  const state = createCanvasConnectionState();
  const selected = computed(
    () =>
      session.state.snapshot.value?.elements.find(
        (element): element is CanvasEdge =>
          element.id === state.selectedId.value && element.type === 'edge'
      ) ?? null
  );
  const labelPreview = createCanvasConnectionLabelPreview(
    id =>
      session.state.snapshot.value?.elements.find(
        (element): element is CanvasEdge => element.type === 'edge' && element.id === id
      ) ?? null
  );
  async function patch(edge: CanvasEdge, value: CanvasPatch) {
    if (edge.locked && value.locked !== false) throw new Error('请先解锁这条连线');
    await session.commit([
      { op: 'update', id: edge.id, baseRevision: edge.revision, patch: value },
    ]);
  }
  const labels = createCanvasConnectionLabelEditing({
    session,
    state,
    patch,
    report: options.report,
  });
  const saveLabel = labels.save;
  const anchorInset = (zoom: number) => options.readAnchorInset?.(zoom) ?? 0;
  const gesture = createCanvasEndpointGesture({
    session,
    kernel,
    state,
    report: options.report,
    createText: options.createText,
    anchorInset,
  });
  return {
    state,
    anchorInset,
    selected,
    patch,
    saveLabel,
    labelPreview,
    labelPoint: (id: CanvasEdgeId) => {
      void options.readDisplayVersion?.();
      return kernel.readEdgeGeometry(id)?.midpoint ?? null;
    },
    geometry: () => {
      void options.readDisplayVersion?.();
      void session.state.snapshot.value;
      return selected.value ? kernel.readEdgeGeometry(selected.value.id) : null;
    },
    toolbarPosition(input: CanvasConnectionToolbarInput) {
      return projectCanvasConnectionToolbar(
        input,
        session.state.snapshot.value?.elements ?? [],
        selected.value?.label ?? ''
      );
    },
    async select(id: CanvasEdgeId | null) {
      if (!(await options.finishText()) || !(await saveLabel())) return;
      state.select(id);
      kernel.setSelectedEdge(id);
      if (id) options.clearCards();
    },
    endpoint(which: 'from' | 'to'): CanvasEndpoint | null {
      return selected.value?.[which] ?? null;
    },
    async reverse() {
      if (!(await saveLabel())) return;
      const edge = selected.value;
      if (edge) await session.commit([buildCanvasConnectionReversal(edge)]);
    },
    beginLabel: () => labels.begin(selected.value),
    async remove() {
      if (selected.value?.locked) throw new Error('请先解锁这条连线');
      if (!(await saveLabel())) return;
      const edge = selected.value;
      if (!edge) return;
      await session.commit([{ op: 'delete', id: edge.id, baseRevision: edge.revision }]);
      state.select(null);
      kernel.setSelectedEdge(null);
    },
    cancelLabel: labels.cancel,
    async suspend() {
      gesture.dispose();
      await labels.release();
    },
    start: gesture.start,
    dispose() {
      labelPreview.dispose();
      gesture.dispose();
      void labels.release().catch(options.report);
    },
  };
}
