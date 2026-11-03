import { computed } from 'vue';
import { JsonValueSchema } from '@app/schemas';
import { createCanvasPlainTextDocument, canvasBounds, type CanvasArrangeRequest, type CanvasCard, type CanvasCardId, type CanvasColor, type CanvasEndpoint, type CanvasPoint } from '@plugin/canvas/shared';
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
import { createCanvasKeyboardHandler, createCanvasKeyboardNavigation, describeCanvasSelection } from '../features/accessibility';
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
import { createCanvasViewportCommands } from './createCanvasViewportCommands';
import { createCanvasDraftDiscard } from './createCanvasDraftDiscard';
import { createCanvasCardOpening } from './createCanvasCardOpening';
import { createCanvasEditorNavigation } from './createCanvasEditorNavigation';
import { installCanvasSurfaceDoubleClick } from './installCanvasSurfaceDoubleClick';
import { canvasDraggedCopySource } from '../functions/canvasDraggedCopySource';

/** 表面的组合根：只连接已提交文档、草稿、选择、kernel与Host端口。 */
export async function createCanvasSurface(options: CanvasSurfaceOptions, ports: CanvasSurfacePorts) {
  const session = createCanvasDocumentSession(ports.document);
  const layout = ports.arrangement ? createCanvasLayoutCommands(session, ports.arrangement) : null;
  const editor = createCanvasCardEditor(session);
  const selection = createCanvasSelection();
  const readonly = computed(() => isCanvasReadonly(session.state.snapshot.value));
  const preferences = useCanvasPreferencesStore();
  const state = createCanvasSurfaceState({ width: options.host.clientWidth, height: options.host.clientHeight });
  const { camera, error, context } = state;
  const report = (value: unknown) => { state.fail(value instanceof Error ? value.message : String(value)); };
  const dragging = createCanvasDragProtection(session, report);
  const resizing = createCanvasCardResize(session, report);
  const readAppearance = () => readCanvasAppearance(preferences.preferences);
  const kernel = await createPixiCanvasKernel({ host: options.host, readReadonly: () => readonly.value, readInteractionPreferences: () => preferences.preferences, onIntent: intent => { void handleIntent(intent).catch(report); } });
  if (options.descriptionId) kernel.canvas.setAttribute('aria-describedby', options.descriptionId);
  const raster = createCanvasRasterPresentation({ host: options.stagingHost, kernel, readAppearance, reportFailure: report, createContent: ports.createContent, readContentKey: ports.readContentKey });
  const refreshView = () => { ports.refreshVisibleContent?.(kernel.renderableCards()); raster.refresh(); };
  const navigate = createCanvasEditorNavigation(kernel, intent => { void handleIntent(intent).catch(report); });
  const editable = ports.createEditor({ element: options.editorHost, content: JsonValueSchema.parse(createCanvasPlainTextDocument('')), label: '文字卡正文', resolveImageSource: ports.resolveImageSource, onError: report,
    onNavigate: navigate,
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
  const finish = async () => { await movement.flush(); return save(true); };
  const opening = createCanvasCardOpening({ kernel, readCard: id => cards().find(card => card.id === id), finish, cameraChanged: () => { state.setCamera(kernel.readCamera()); refreshView(); }, prepare: raster.prepareEditing, openText: (id, signal) => editor.open(id, undefined, signal), openMedia: card => ports.openCard?.(card), opened: ports.cardOpened, unavailable: () => state.setRenderNotice('当前无法生成精确预览，已继续使用正文编辑器。') });
  async function trySelect(ids: readonly CanvasCardId[], additive = false) {
    opening.cancel();
    if (!(await finish())) return false;
    if (!(await connections.saveLabel())) return false;
    if (ids.length || !additive) await connections.select(null);
    selection.select(mergeCanvasSelection(selection.ids.value, ids, additive)); kernel.setSelection(selection.ids.value);
    return true;
  }
  const select = async (ids: readonly CanvasCardId[], additive = false) => { await trySelect(ids, additive); };
  const connections = createCanvasConnectionEditing(session, kernel, { finishText: finish, createText: (point, from) => createText(point, '', from), clearCards: () => { selection.select([]); kernel.setSelection([]); }, report, readDisplayVersion: () => state.displayVersion.value });
  const stopReadonly = installCanvasReadonlyProjection({ readonly, editable, clearPreview: () => kernel.clearDragPreview(), cancelResize: resizing.dispose, suspendEditor: editor.suspend, suspendConnections: connections.suspend, cancelDrag: dragging.cancel, cancelLayout: async () => { await layout?.cancel(); }, report });
  const actions = createCanvasElementActions(session, { read: () => selection.ids.value, select });
  async function createText(point?: CanvasPoint, text = '', from: CanvasEndpoint | null = null, arrangement: CanvasArrangeRequest['options'] | null = null) {
    opening.cancel();
    requireWritableCanvas(session.state.snapshot.value);
    if (!(await finish()) || !(await connections.saveLabel())) return;
    const target = point ?? kernel.screenToWorld({ x: options.host.clientWidth / 2 - 140, y: options.host.clientHeight / 2 - 90 });
    selection.select([]); kernel.setSelection([]); await connections.select(null); creation.begin(target, from, text, arrangement); setDirty();
  }
  const createTree = async (kind: 'child' | 'sibling') => { if (!layout || !(await finish())) return; const plan = layout.planTree(selection.ids.value, kind); await createText(plan.point, '', plan.from, plan.options); };
  async function handleIntent(intent: CanvasKernelIntent) {
    switch (intent.kind) {
      case 'preview-changed': state.advanceDisplay(); refreshView(); return;
      case 'hover': state.setHovered(intent.id); connections.labelPreview.hover(intent.edgeId); return;
      case 'render-status': state.setRenderNotice(intent.message); return;
      case 'select-edge': await connections.select(intent.id); return;
      case 'select': await select(intent.ids, intent.additive); return;
      case 'editing': await dragging.set(intent.ids, intent.active); return;
      case 'move':
        if (intent.copy) { try { await actions.duplicate(canvasDraggedCopySource(selectCanvasSubgraph(session.state.snapshot.value?.elements ?? [], intent.ids), intent.positions, intent.dx, intent.dy), intent.dx, intent.dy); } finally { kernel.clearDragPreview(); await dragging.set(intent.ids, false); } }
        else await movement.place(intent.ids, intent.positions); return;
      case 'open': await opening.open(intent.id); return;
      case 'camera': state.setCamera(intent.camera); refreshView(); return;
      case 'context': if (await viewport.selectContext(intent)) state.setContext(intent); return;
    }
  }
  const projection = installCanvasEditorProjection({ host: options.editorHost, editor, creation, editable, kernel, camera, detailId: state.detailId, cards, setDirty, refresh: refreshView });
  const stopDisplay = installCanvasDisplayProjection({ host: options.host, session, kernel, raster: { refresh: refreshView }, preferences, readAppearance, ports, report, refreshEditorInk: projection.refreshInk, viewportChanged: state.setViewport });
  const stopDoubleClick = installCanvasSurfaceDoubleClick({ host: options.host, kernel, readonly: () => readonly.value, create: createText, label: async id => { await connections.select(id); await connections.beginLabel(); }, report });
  const clipboard = installCanvasSurfaceClipboard({ host: options.host, kernel, session, ports, actions, canHandle: () => !editor.state.draft.value && !creation.state.draft.value, selection: () => selection.ids.value, contextPoint: () => context.value?.point, select, createText, report });
  const removeSave = registerCanvasSaveParticipant({ documentId: options.documentId, save });
  const draftParticipants = createCanvasRestoreDraftParticipants({ editor, creation, connections, report });
  const changedDraft = () => { setDirty(); state.clearFailure(); };
  const removeHistory = installCanvasHistoryRestore({ documentId: options.documentId, session, subscribe: ports.subscribeRestored, participants: draftParticipants, changed: changedDraft, report });
  // kernel显示坐标不属于Vue状态；版本只触发单卡DOM投影读取，不复制整张场景。
  const displayCard = (card: CanvasCard) => { void state.displayVersion.value; const position = kernel.readDisplayPosition(card.id); return position ? { ...card, ...position } : card; };
  const selectedCards = computed(() => { const result = selected(); return result.length === 1 ? result.map(displayCard) : result; });
  const selectionStyle = computed(() => canvasSelectionToolbarStyle(canvasBounds(selectedCards.value), camera.value, options.host.clientWidth));
  const resizeStyle = computed(() => cardEditorStyle(resizing.state.preview.value ?? (selectedCards.value.length === 1 ? selectedCards.value[0] : undefined), camera.value));
  const viewport = createCanvasViewportCommands({ kernel, setCamera: state.setCamera, refresh: refreshView, cards, selected, elements: () => session.state.snapshot.value?.elements ?? [], select: trySelect, selectEdge: async id => { await connections.select(id); return connections.selected.value?.id === id; } });
  const { zoom, fit } = viewport;
  const discardDraft = createCanvasDraftDiscard({ participants: draftParticipants, saving: () => Boolean(editor.state.saving.value || creation.state.saving.value || session.mutationPending.value), changed: changedDraft, focus: viewport.focus });
  async function color(value: CanvasColor) { const commands = buildColorCommands(session.state.snapshot.value?.elements ?? [], selection.ids.value, value); if (commands.length) await session.commit(commands); }
  async function remove() { if (connections.selected.value) { await connections.remove(); return; } if (!(await finish())) return; const commands = buildDeleteCommands(session.state.snapshot.value?.elements ?? [], selection.ids.value); if (commands.length) await session.commit(commands); await select([]); }
  async function undo(direction: 'undo' | 'redo') { await layout?.flush(); if (await finish()) await session.undo(direction); }
  const edit = async () => { if (connections.selected.value) { await connections.beginLabel(); return; } const id = selection.ids.value[0]; if (id) await opening.open(id); };
  const keydown = createCanvasKeyboardHandler({ isEditing: () => Boolean(editor.state.draft.value || creation.state.draft.value || connections.state.label.value), selection: () => selection.ids.value, allIds: () => cards().map(card => card.id),
    treeMode: () => Boolean(layout?.state.treeKeyboard.value && selection.ids.value.length === 1), createTree,
    zoomValue: () => camera.value.zoom, duplicate: () => actions.duplicate(), undo, remove, edit, select, fit, zoom, move: movement.move, navigation: createCanvasKeyboardNavigation({ cards, selection: () => selection.ids.value, select, reveal: viewport.reveal }),
    escape: async () => { const wasEditing = Boolean(editor.state.draft.value || creation.state.draft.value); if (await finish()) { if (!wasEditing) await select([]); kernel.canvas.focus(); } },
  });
  try { kernel.setAppearance(readAppearance()); await session.open(options.documentId); }
  catch (failure) { report(failure); }
  return {
    session, editor, creation, readonly, integrityNotice: computed(() => canvasIntegrityNotice(session.state.snapshot.value)), renderNotice: state.renderNotice, layout, connections, selection, editingDraft: computed(() => Boolean(editor.state.draft.value || creation.state.draft.value)), setComposing: (value: boolean) => { creation.setComposing(value); editor.setComposing(value); }, captureInsertion: editable.captureInsertion, worldPoint: (point: CanvasPoint) => kernel.screenToWorld(point), centerPoint: () => kernel.screenToWorld({ x: options.host.clientWidth / 2, y: options.host.clientHeight / 2 }), camera, error, context, editorStyle: projection.style, resizeStyle, selectionStyle, selectedCards, hoveredCard: computed(() => { const card = cards().find(card => card.id === state.hoveredId.value); return card ? displayCard(card) : null; }), actions, createText, select, color, remove, fit, zoom, undo, report,
    async arrange(request: CanvasArrangeRequest['options']) { if (!layout || !(await finish())) return; await layout.run({ ...request, ...(selection.ids.value.length ? { elementIds: [...selection.ids.value] } : {}) }); layout.state.setDirection(request.direction); layout.state.setTreeKeyboard(request.algorithm === 'tree'); fit(Boolean(selection.ids.value.length)); },
    async connect() { if (await finish()) await connections.select(await actions.connect()); },
    clipboard, discardDraft, hasDraft: computed(() => draftParticipants.some(participant => participant.readGeneration() !== null)), focus: viewport.focus, focusElements: viewport.focusElements, focusRectangle: viewport.focusRectangle, prepareMutation: async () => await finish() && await connections.saveLabel(),
    readPresentationStats: () => ({ ...kernel.readStats(), status: kernel.readRenderStatus() }), viewport: state.viewport,
    readContentReadiness: (ids: readonly CanvasCardId[]) => raster.readReadiness(ids),
    prepareDetail: (id: CanvasCardId) => { kernel.finishTransitions([id]); state.advanceDisplay(); return raster.prepareEditing(id); }, setDetailVisible: state.setDetailVisible, navigate,
    selectionDescription: computed(() => describeCanvasSelection(session.state.snapshot.value?.elements ?? [], connections.selected.value ? [connections.selected.value.id] : selection.ids.value, ports.readDocumentTitles?.() ?? new Map())),
    clearFailure: state.clearFailure,
    retryDisplay() { state.clearFailure(); ports.retryContent?.(); raster.retry(); refreshView(); },
    resizeStart(event: PointerEvent) { if (readonly.value) return; const card = selectedCards.value[0]; if (card && selectedCards.value.length === 1) { kernel.finishTransitions([card.id]); const target = cards().find(item => item.id === card.id); if (target) resizing.start(target, event, camera.value.zoom); } },
    closeContext() { state.setContext(null); viewport.focus(); },
    contextStyle: computed(() => { const point = context.value?.point; const screen = point ? kernel.worldToScreen(point) : { x: 0, y: 0 }; return { left: `${Math.min(Math.max(8, screen.x), options.host.clientWidth - 180)}px`, top: `${Math.min(Math.max(8, screen.y), options.host.clientHeight - 320)}px` }; }),
    locate: viewport.locate,
    locateEndpoint: (which: 'from' | 'to') => viewport.locateEndpoint(connections.endpoint(which)),
    keydown: (event: KeyboardEvent) => { state.clearFailure(); void keydown(event).catch(report); },
    edit,
    destroy() { opening.dispose(); void layout?.dispose().catch(report); connections.dispose(); dragging.dispose(); resizing.dispose(); clipboard.dispose(); removeSave(); removeHistory(); stopReadonly(); stopDisplay(); projection.dispose(); stopDoubleClick(); editable.destroy(); editor.dispose(); void session.close().catch(report); raster.dispose(); kernel.destroy(); },
  };
}
