import { computed, watch } from 'vue';
import { JsonValueSchema } from '@app/schemas';
import { createCanvasPlainTextDocument, type CanvasCard, type CanvasCardId, type CanvasColor, type CanvasElementId, type CanvasPoint } from '@plugin/canvas/shared';
import { createPixiCanvasKernel, type CanvasAppearance, type CanvasKernelIntent } from '../kernel';
import { createCanvasDocumentSession, registerCanvasSaveParticipant } from '../features/canvasDocument';
import { createCanvasCardEditor } from '../features/cardEditing';
import { createCanvasSelection, mergeCanvasSelection } from '../features/selection';
import { buildColorCommands, buildDeleteCommands, buildMoveCommands } from '../features/elementEditing';
import { useCanvasPreferencesStore } from '../features/materialSetting';
import { createCanvasRasterPresentation } from './createCanvasRasterPresentation';
import type { CanvasSurfaceOptions, CanvasSurfacePorts } from '../definitions/canvasSurface';
import { createCanvasSurfaceState } from '../store/createCanvasSurfaceState';
import { cardEditorStyle } from '../features/cardEditing/functions/cardEditorStyle';
import { readCanvasShortcut } from '../functions/readCanvasShortcut';

/** 表面的组合根：只连接已提交文档、草稿、选择、kernel与Host端口。 */
export async function createCanvasSurface(options: CanvasSurfaceOptions, ports: CanvasSurfacePorts) {
  const session = createCanvasDocumentSession(ports.document);
  const editor = createCanvasCardEditor(session);
  const selection = createCanvasSelection();
  const preferences = useCanvasPreferencesStore();
  const state = createCanvasSurfaceState();
  const { camera, error, context } = state;
  const report = (value: unknown) => { state.fail(value instanceof Error ? value.message : String(value)); };
  const readAppearance = (): CanvasAppearance => ({ dark: document.documentElement.dataset.theme === 'dark' || document.documentElement.classList.contains('dark'), material: preferences.preferences.material, overview: preferences.preferences.overview });
  const kernel = await createPixiCanvasKernel({ host: options.host, onIntent: intent => { void handleIntent(intent).catch(report); } });
  const raster = createCanvasRasterPresentation({ host: options.stagingHost, kernel, readAppearance, reportFailure: report });
  const editable = ports.createEditor({ element: options.editorHost, content: JsonValueSchema.parse(createCanvasPlainTextDocument('')), label: '文字卡正文',
    onUpdate: content => { try { editor.update(content); setDirty(); } catch (failure) { report(failure); } },
    onBlur: () => { void editor.save(true).then(setDirty).catch(report); },
  });
  const cards = () => session.state.snapshot.value?.elements.filter((element): element is CanvasCard => element.type !== 'edge') ?? [];
  const selected = () => cards().filter(card => selection.ids.value.includes(card.id));
  const setDirty = () => {
    const draft = editor.state.draft.value;
    ports.markDirty(Boolean(draft && draft.editSequence !== draft.savedSequence));
  };
  const finish = async () => { const saved = await editor.save(true); setDirty(); return saved; };
  async function select(ids: readonly CanvasCardId[], additive = false) {
    if (!(await finish())) return;
    selection.select(mergeCanvasSelection(selection.ids.value, ids, additive)); kernel.setSelection(selection.ids.value);
  }
  async function createText(point?: CanvasPoint, text = '') {
    if (!(await finish())) return;
    const target = point ?? kernel.screenToWorld({ x: options.host.clientWidth / 2 - 140, y: options.host.clientHeight / 2 - 90 });
    const result = await session.commit([{ op: 'addText', ref: '$new', x: target.x, y: target.y, width: 280, height: 180, content: createCanvasPlainTextDocument(text) }]);
    const id = result.refs.$new;
    if (id?.startsWith('c')) {
      const card = cards().find(candidate => candidate.id === id);
      if (card) { await select([card.id]); await editor.open(card.id); }
    }
  }
  async function move(ids: readonly CanvasCardId[], dx: number, dy: number) {
    try { const commands = buildMoveCommands(session.state.snapshot.value?.elements ?? [], ids, dx, dy); if (commands.length) await session.commit(commands); }
    finally { kernel.clearDragPreview(); await Promise.all(ids.map(id => session.protect(id, []))); }
  }
  async function handleIntent(intent: CanvasKernelIntent) {
    switch (intent.kind) {
      case 'select': await select(intent.ids, intent.additive); return;
      case 'editing': await Promise.all(intent.ids.map(id => session.protect(id, intent.active ? ['x', 'y', 'width', 'height'] : []))); return;
      case 'move': await move(intent.ids, intent.dx, intent.dy); return;
      case 'open': await editor.open(intent.id); return;
      case 'camera': state.setCamera(intent.camera); raster.refresh(); return;
      case 'context': state.setContext(intent); return;
    }
  }
  const stopSnapshot = watch(session.state.snapshot, snapshot => { if (snapshot) { kernel.setElements(snapshot.elements); raster.refresh(); } });
  const stopDraft = watch(() => editor.state.draft.value?.elementId, () => {
    const draft = editor.state.draft.value;
    kernel.setEditingCard(draft?.elementId ?? null);
    if (draft) { editable.replaceContent(JsonValueSchema.parse(draft.content)); editable.focus(); }
    else { setDirty(); raster.refresh(); }
  });
  const stopAppearance = watch(() => preferences.preferences, () => { kernel.setAppearance(readAppearance()); raster.refresh(); });
  const resize = () => { kernel.resize(options.host.clientWidth, options.host.clientHeight, devicePixelRatio); raster.refresh(); };
  const observer = new ResizeObserver(resize); observer.observe(options.host);
  const themeObserver = new MutationObserver(() => { kernel.setAppearance(readAppearance()); raster.refresh(); });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
  const doubleClick = (event: MouseEvent) => {
    if (event.target !== kernel.canvas) return;
    const box = kernel.canvas.getBoundingClientRect();
    const point = kernel.screenToWorld({ x: event.clientX - box.left, y: event.clientY - box.top });
    if (!kernel.hitTest(point)) void createText(point).catch(report);
  };
  options.host.addEventListener('dblclick', doubleClick);
  const removeSave = registerCanvasSaveParticipant({ documentId: options.documentId, save: async final => { const result = await editor.save(final); setDirty(); return result; } });
  const editorStyle = computed(() => cardEditorStyle(cards().find(card => card.id === editor.state.draft.value?.elementId), camera.value));
  const zoom = (value: number) => { kernel.setCamera({ ...camera.value, zoom: value }); state.setCamera(kernel.readCamera()); raster.refresh(); };
  const fit = (onlySelected = false) => { kernel.fit(onlySelected ? selected() : cards()); state.setCamera(kernel.readCamera()); raster.refresh(); };
  async function color(value: CanvasColor) { const commands = buildColorCommands(session.state.snapshot.value?.elements ?? [], selection.ids.value, value); if (commands.length) await session.commit(commands); }
  async function remove() { if (!(await finish())) return; const commands = buildDeleteCommands(session.state.snapshot.value?.elements ?? [], selection.ids.value); if (commands.length) await session.commit(commands); await select([]); }
  async function undo(direction: 'undo' | 'redo') { if (await finish()) await session.undo(direction); }
  async function keydown(event: KeyboardEvent) {
    const action = readCanvasShortcut(event, Boolean(editor.state.draft.value));
    if (!action) return;
    event.preventDefault();
    switch (action) {
      case 'undo': await undo('undo'); return;
      case 'redo': await undo('redo'); return;
      case 'delete': await remove(); return;
      case 'edit': if (selection.ids.value[0]) await editor.open(selection.ids.value[0]); return;
      case 'escape': if (await finish()) { await select([]); kernel.canvas.focus(); } return;
      case 'all': await select(cards().map(card => card.id)); return;
      case 'actual': zoom(1); return;
      case 'fit': fit(); return;
      case 'fit-selection': fit(true); return;
      case 'zoom-in': zoom(camera.value.zoom * 1.25); return;
      case 'zoom-out': zoom(camera.value.zoom / 1.25); return;
      default: {
        const step = event.shiftKey ? 10 : 1;
        await move(selection.ids.value, action === 'left' ? -step : action === 'right' ? step : 0, action === 'up' ? -step : action === 'down' ? step : 0);
      }
    }
  }
  try { kernel.setAppearance(readAppearance()); await session.open(options.documentId); }
  catch (failure) { report(failure); }
  return {
    session, editor, selection, camera, error, context, editorStyle, createText, select, color, remove, fit, zoom, undo, report,
    locate(ids: readonly CanvasElementId[]) { const elements = cards().filter(element => ids.includes(element.id)); kernel.fit(elements); state.setCamera(kernel.readCamera()); raster.refresh(); },
    keydown: (event: KeyboardEvent) => { void keydown(event).catch(report); },
    edit: async () => { const id = selection.ids.value[0]; if (id) await editor.open(id); },
    destroy() { removeSave(); stopSnapshot(); stopDraft(); stopAppearance(); observer.disconnect(); themeObserver.disconnect(); options.host.removeEventListener('dblclick', doubleClick); editable.destroy(); editor.dispose(); void session.close().catch(report); raster.dispose(); kernel.destroy(); },
  };
}
