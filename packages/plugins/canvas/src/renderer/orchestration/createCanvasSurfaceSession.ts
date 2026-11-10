import { type CanvasCard } from '@plugin/canvas/shared';
import { computed } from 'vue';
import type { CanvasSurfaceOptions, CanvasSurfacePorts } from '../definitions/canvasSurface';
import { createCanvasDocumentSession, isCanvasReadonly } from '../features/canvasDocument';
import { createCanvasCardEditor } from '../features/cardEditing';
import { createCanvasCardResize } from '../features/cardResizing';
import { createCanvasDragProtection } from '../features/elementEditing';
import { createCanvasLayoutCommands } from '../features/layoutCommands';
import { useCanvasPreferencesStore } from '../features/materialSetting';
import { createCanvasSelection } from '../features/selection';
import { readCanvasAppearance } from '../functions/readCanvasAppearance';
import { createCanvasSurfaceState } from '../store/createCanvasSurfaceState';

/** 文档与局部交互能力的装配；业务状态仍由各 feature 自己持有。 */
export function createCanvasSurfaceSession(
  options: CanvasSurfaceOptions,
  ports: CanvasSurfacePorts
) {
  const session = createCanvasDocumentSession(ports.document);
  const layout = ports.arrangement ? createCanvasLayoutCommands(session, ports.arrangement) : null;
  const editor = createCanvasCardEditor(session);
  const selection = createCanvasSelection();
  const readonly = computed(() => isCanvasReadonly(session.state.snapshot.value));
  const preferences = useCanvasPreferencesStore();
  const state = createCanvasSurfaceState({
    width: options.host.clientWidth,
    height: options.host.clientHeight,
  });
  const report = (value: unknown) => {
    state.fail(value instanceof Error ? value.message : String(value));
  };
  const dragging = createCanvasDragProtection(session, report);
  const resizing = createCanvasCardResize(session, report);
  const readAppearance = () => readCanvasAppearance(preferences.preferences);
  const cards = () =>
    session.state.snapshot.value?.elements.filter(
      (element): element is CanvasCard => element.type !== 'edge'
    ) ?? [];
  const selected = () => cards().filter(card => selection.ids.value.includes(card.id));
  return {
    session,
    layout,
    editor,
    selection,
    readonly,
    preferences,
    state,
    report,
    dragging,
    resizing,
    readAppearance,
    cards,
    selected,
  };
}
