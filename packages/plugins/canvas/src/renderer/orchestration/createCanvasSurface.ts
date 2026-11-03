import { computed } from 'vue';
import { JsonValueSchema } from '@app/schemas';
import { createCanvasPlainTextDocument, canvasBounds, type CanvasArrangeRequest, type CanvasCard, type CanvasCardId, type CanvasColor, type CanvasElementId, type CanvasEndpoint, type CanvasPoint } from '@plugin/canvas/shared';
import { createPixiCanvasKernel, type CanvasKernelIntent } from '../kernel';
import { createCanvasDocumentSession, registerCanvasSaveParticipant, requireWritableCanvas, isCanvasReadonly } from '../features/canvasDocument';
import { createCanvasCardEditor, cardEditorStyle } from '../features/cardEditing';
import { createCanvasSelection, mergeCanvasSelection } from '../features/selection';
import { buildColorCommands, buildDeleteCommands, createCanvasElementActions, createCanvasCardMovement, createCanvasDragProtection } from '../features/elementEditing';
import { useCanvasPreferencesStore } from '../features/materialSetting';
import { createCanvasCardResize } from '../features/cardResizing';
import { canvasSelectionToolbarStyle } from '../functions/canvasSelectionToolbarStyle';
import { createCanvasRasterPresentation } from './createCanvasRasterPresentation';
import type { CanvasSurfaceOptions, CanvasSurfacePorts } from '../definitions/canvasSurface';
import { createCanvasSurfaceState } from '../store/createCanvasSurfaceState';
import { selectCanvasSubgraph } from '../features/clipboard';
import { createCanvasKeyboardHandler } from '../features/accessibility';
import { createCanvasConnectionEditing } from '../features/connections';
import { installCanvasEditorProjection } from './installCanvasEditorProjection';
import { installCanvasDisplayProjection } from './installCanvasDisplayProjection';
import { createCanvasTextCreation } from '../features/textCreation';
import { installCanvasSurfaceClipboard } from './installCanvasSurfaceClipboard';
import { createCanvasLayoutCommands } from '../features/layoutCommands';
import { installCanvasReadonlyProjection } from './installCanvasReadonlyProjection';
import { canvasIntegrityNotice } from '../functions/canvasIntegrityNotice';
import { installCanvasHistoryRestore } from './installCanvasHistoryRestore';
import { createCanvasRestoreDraftParticipants } from './createCanvasRestoreDraftParticipants';
import { readCanvasAppearance } from '../functions/readCanvasAppearance';

/** 表面的组合根：只连接已提交文档、草稿、选择、kernel与Host端口。 */
export async function createCanvasSurface(options: CanvasSurfaceOptions, ports: CanvasSurfacePorts) {
  const session = createCanvasDocumentSession(ports.document);
  const layout = ports.arrangement ? createCanvasLayoutCommands(session, ports.arrangement) : null;
  const editor = createCanvasCardEditor(session);
  const selection = createCanvasSelection();
  const readonly = computed(() => isCanvasReadonly(session.state.snapshot.value));
  const preferences = useCanvasPreferencesStore();
  const state = createCanvasSurfaceState();
  const { camera, error, context } = state;
  const report = (value: unknown) => { state.fail(value instanceof Error ? value.message : String(value)); };
  const dragging = createCanvasDragProtection(session, report);
  const resizing = createCanvasCardResize(session, report);
  const readAppearance = () => readCanvasAppearance(preferences.preferences);
  const kernel = await createPixiCanvasKernel({ host: options.host, readReadonly: () => readonly.value, readInteractionPreferences: () => preferences.preferences, onIntent: intent => { void handleIntent(intent).catch(report); } });
  const raster = createCanvasRasterPresentation({ host: options.stagingHost, kernel, readAppearance, reportFailure: report, createContent: ports.createContent, readContentKey: ports.readContentKey });
  const refreshView = () => { ports.refreshVisibleContent?.(kernel.renderableCards()); raster.refresh(); };
  const editable = ports.createEditor({ element: options.editorHost, content: JsonValueSchema.parse(createCanvasPlainTextDocument('')), label: '文字卡正文', resolveImageSource: ports.resolveImageSource, onError: report,
    onUpdate: content => { try { if (creation.state.draft.value) creation.update(content); else editor.update(content); setDirty(); } catch (failure) { report(failure); } },
    onBlur: () => { void save(true).then(setDirty).catch(report); },
  });
  const cards = () => session.state.snapshot.value?.elements.filter((element): element is CanvasCard => element.type !== 'edge') ?? [];
  const creation = createCanvasTextCreation(session, async (id, continueEditing, readRemaining, historyGroupId) => { selection.select([id]); kernel.setSelection([id]); if (continueEditing) { await editor.open(id, historyGroupId); const remaining = readRemaining(); if (remaining) { editor.update(JsonValueSchema.parse(remaining)); editor.measure(creation.state.draft.value?.height ?? 64); } } },
    (operations, historyGroupId, arrangement) => { if (!arrangement) return session.commit(operations, historyGroupId); if (!layout) throw new Error('当前表面未配置自动排布'); return layout.run(arrangement, operations, historyGroupId); });
  const selected = () => cards().filter(card => selection.ids.value.includes(card.id));
  const setDirty = () => {
    const draft = editor.state.draft.value;
    ports.markDirty(creation.hasContent() || Boolean(draft && draft.editSequence !== draft.savedSequence));
  };
  const save = async (final: boolean) => { if (!(await creation.save(final))) return false; const saved = await editor.save(final); setDirty(); return saved; };
  const movement = createCanvasCardMovement(session, async ids => { kernel.clearDragPreview(); await dragging.set(ids, false); });
  const move = movement.move;
  const finish = async () => { await movement.flush(); return save(true); };
  async function select(ids: readonly CanvasCardId[], additive = false) {
    if (!(await finish())) return;
    if (!(await connections.saveLabel())) return;
    if (ids.length || !additive) await connections.select(null);
    selection.select(mergeCanvasSelection(selection.ids.value, ids, additive)); kernel.setSelection(selection.ids.value);
  }
  const connections = createCanvasConnectionEditing(session, kernel, { finishText: finish, createText: (point, from) => createText(point, '', from), clearCards: () => { selection.select([]); kernel.setSelection([]); }, report });
  const stopReadonly = installCanvasReadonlyProjection({ readonly, editable, clearPreview: () => kernel.clearDragPreview(), cancelResize: resizing.dispose, suspendEditor: editor.suspend, suspendConnections: connections.suspend, cancelDrag: dragging.cancel, cancelLayout: async () => { await layout?.cancel(); }, report });
  const actions = createCanvasElementActions(session, { read: () => selection.ids.value, select });
  async function createText(point?: CanvasPoint, text = '', from: CanvasEndpoint | null = null, arrangement: CanvasArrangeRequest['options'] | null = null) {
    requireWritableCanvas(session.state.snapshot.value);
    if (!(await finish()) || !(await connections.saveLabel())) return;
    const target = point ?? kernel.screenToWorld({ x: options.host.clientWidth / 2 - 140, y: options.host.clientHeight / 2 - 90 });
    selection.select([]); kernel.setSelection([]); await connections.select(null); creation.begin(target, from, text, arrangement); setDirty();
  }
  const createTree = async (kind: 'child' | 'sibling') => { if (!layout || !(await finish())) return; const plan = layout.planTree(selection.ids.value, kind); await createText(plan.point, '', plan.from, plan.options); };
  async function handleIntent(intent: CanvasKernelIntent) {
    switch (intent.kind) {
      case 'render-status': state.setRenderNotice(intent.message); return;
      case 'select-edge': await connections.select(intent.id); return;
      case 'select': await select(intent.ids, intent.additive); return;
      case 'editing': await dragging.set(intent.ids, intent.active); return;
      case 'move':
        if (intent.copy) { try { await actions.duplicate(selectCanvasSubgraph(session.state.snapshot.value?.elements ?? [], intent.ids), intent.dx, intent.dy); } finally { kernel.clearDragPreview(); await dragging.set(intent.ids, false); } }
        else await move(intent.ids, intent.dx, intent.dy); return;
      case 'open': await openCard(intent.id); return;
      case 'camera': state.setCamera(intent.camera); refreshView(); return;
      case 'context': if (intent.id && !selection.ids.value.includes(intent.id)) await select([intent.id]); state.setContext(intent); return;
    }
  }
  const projection = installCanvasEditorProjection({ host: options.editorHost, editor, creation, editable, kernel, camera, cards, setDirty, refresh: refreshView });
  const editorStyle = projection.style;
  const stopDisplay = installCanvasDisplayProjection({ host: options.host, session, kernel, raster: { refresh: refreshView }, preferences, readAppearance, ports, report, refreshEditorInk: projection.refreshInk });
  const doubleClick = (event: MouseEvent) => {
    if (event.target !== kernel.canvas) return;
    const box = kernel.canvas.getBoundingClientRect();
    const point = kernel.screenToWorld({ x: event.clientX - box.left, y: event.clientY - box.top });
    if (readonly.value) return;
    const edge = kernel.hitTestEdge(point);
    if (edge && !kernel.hitTest(point)) void connections.select(edge.id).then(() => connections.beginLabel()).catch(report);
    else if (!kernel.hitTest(point)) void createText(point).catch(report);
  };
  options.host.addEventListener('dblclick', doubleClick);
  const clipboard = installCanvasSurfaceClipboard({ host: options.host, kernel, session, ports, actions, canHandle: () => !editor.state.draft.value && !creation.state.draft.value, selection: () => selection.ids.value, contextPoint: () => context.value?.point, select, createText, report });
  const removeSave = registerCanvasSaveParticipant({ documentId: options.documentId, save });
  const removeHistory = installCanvasHistoryRestore({ documentId: options.documentId, session, subscribe: ports.subscribeRestored,
    participants: createCanvasRestoreDraftParticipants({ editor, creation, connections, report }), changed: () => { setDirty(); state.clearFailure(); }, report });
  const selectedCards = computed(selected);
  const selectionStyle = computed(() => canvasSelectionToolbarStyle(canvasBounds(selectedCards.value), camera.value, options.host.clientWidth));
  const resizeStyle = computed(() => cardEditorStyle(resizing.state.preview.value ?? (selectedCards.value.length === 1 ? selectedCards.value[0] : undefined), camera.value));
  const zoom = (value: number) => { kernel.setCamera({ ...camera.value, zoom: value }); state.setCamera(kernel.readCamera()); refreshView(); };
  const fit = (onlySelected = false) => { kernel.fit(onlySelected ? selected() : cards()); state.setCamera(kernel.readCamera()); refreshView(); };
  async function color(value: CanvasColor) { const commands = buildColorCommands(session.state.snapshot.value?.elements ?? [], selection.ids.value, value); if (commands.length) await session.commit(commands); }
  async function remove() { if (connections.selected.value) { await connections.remove(); return; } if (!(await finish())) return; const commands = buildDeleteCommands(session.state.snapshot.value?.elements ?? [], selection.ids.value); if (commands.length) await session.commit(commands); await select([]); }
  async function undo(direction: 'undo' | 'redo') { await layout?.flush(); if (await finish()) await session.undo(direction); }
  const openCard = async (id: CanvasCardId) => { const card = cards().find(item => item.id === id); if (!card || !(await finish())) return; if (card.type === 'text') await editor.open(id); else await ports.openCard?.(card); };
  const edit = async () => { if (connections.selected.value) { await connections.beginLabel(); return; } const id = selection.ids.value[0]; if (id) await openCard(id); };
  const keydown = createCanvasKeyboardHandler({ isEditing: () => Boolean(editor.state.draft.value || creation.state.draft.value || connections.state.label.value), selection: () => selection.ids.value, allIds: () => cards().map(card => card.id),
    treeMode: () => Boolean(layout?.state.treeKeyboard.value && selection.ids.value.length === 1), createTree,
    zoomValue: () => camera.value.zoom, duplicate: () => actions.duplicate(), undo, remove, edit, select, fit, zoom, move,
    escape: async () => { const wasEditing = Boolean(editor.state.draft.value || creation.state.draft.value); if (await finish()) { if (!wasEditing) await select([]); kernel.canvas.focus(); } },
  });
  try { kernel.setAppearance(readAppearance()); await session.open(options.documentId); }
  catch (failure) { report(failure); }
  return {
    session, editor, creation, readonly, integrityNotice: computed(() => canvasIntegrityNotice(session.state.snapshot.value)), renderNotice: state.renderNotice, layout, connections, selection, editingDraft: computed(() => Boolean(editor.state.draft.value || creation.state.draft.value)), setComposing: (value: boolean) => { creation.setComposing(value); editor.setComposing(value); }, captureInsertion: editable.captureInsertion, worldPoint: (point: CanvasPoint) => kernel.screenToWorld(point), centerPoint: () => kernel.screenToWorld({ x: options.host.clientWidth / 2, y: options.host.clientHeight / 2 }), camera, error, context, editorStyle, resizeStyle, selectionStyle, selectedCards, actions, createText, select, color, remove, fit, zoom, undo, report,
    async arrange(request: CanvasArrangeRequest['options']) { if (!layout || !(await finish())) return; await layout.run({ ...request, ...(selection.ids.value.length ? { elementIds: [...selection.ids.value] } : {}) }); layout.state.setDirection(request.direction); layout.state.setTreeKeyboard(request.algorithm === 'tree'); fit(Boolean(selection.ids.value.length)); },
    async connect() { if (await finish()) await connections.select(await actions.connect()); },
    clipboard,
    clearFailure: state.clearFailure,
    retryDisplay() { state.clearFailure(); ports.retryContent?.(); raster.retry(); refreshView(); },
    resizeStart(event: PointerEvent) { if (readonly.value) return; const card = selectedCards.value[0]; if (card && selectedCards.value.length === 1) resizing.start(card, event, camera.value.zoom); },
    closeContext() { state.setContext(null); },
    contextStyle: computed(() => { const point = context.value?.point; const screen = point ? kernel.worldToScreen(point) : { x: 0, y: 0 }; return { left: `${Math.min(Math.max(8, screen.x), options.host.clientWidth - 180)}px`, top: `${Math.min(Math.max(8, screen.y), options.host.clientHeight - 320)}px` }; }),
    locate(ids: readonly CanvasElementId[]) { const elements = cards().filter(element => ids.includes(element.id)); kernel.fit(elements); state.setCamera(kernel.readCamera()); refreshView(); },
    keydown: (event: KeyboardEvent) => { state.clearFailure(); void keydown(event).catch(report); },
    edit,
    destroy() { void layout?.dispose().catch(report); connections.dispose(); dragging.dispose(); resizing.dispose(); clipboard.dispose(); removeSave(); removeHistory(); stopReadonly(); stopDisplay(); projection.dispose(); options.host.removeEventListener('dblclick', doubleClick); editable.destroy(); editor.dispose(); void session.close().catch(report); raster.dispose(); kernel.destroy(); },
  };
}
