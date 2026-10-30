import { computed, shallowRef, watch } from 'vue';
import { rectFromPoints, type RenderNodeSelectionRect } from '../../renderNodeSelection';
import type { CanvasPointerGesture, CanvasSnapGuide } from '../definitions/canvasGesture';
import { snapCanvasTranslation } from '../functions/snapCanvasTranslation';
import { ownsCanvasKeyboard, readCanvasNudge } from '../functions/canvasKeyboard';
import { storeToRefs } from 'pinia';
import { quantizeManualTranslation, type SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import {
  resolveSlidePointerPoint,
  type SourceSelectionPoint,
} from '../../sourceSelection';
import {
  type ManualEditableTarget,
  collectPresentedManualTargets, normalizeManualSelection, toggleManualSelection, collectManualMarqueeSelection, manualSelectionBounds,
  manualSelectionContext,
  type ManualEditingVisualOperation,
  createPresentedTextEditingTarget,
  findManualEditableTargetPathAtPoint,
  findManualEditableTargetPathByElementId,
  type ManualEditingHitProjection,
  useSlidesManualEditingStore,
  createManualVisualPreview,
  resolveManualClickSelection,
  createManualDeleteOperation,
} from '../../manualEditing';
import { useTextInputSession } from './useTextInputSession';
import { useSlidesEditingInteractionStore } from '../store/slidesEditingInteractionStore';
import { projectTextDraftPresentations } from '../functions/projectTextDraftPresentations';

import type { SlideEditingInteractionOptions } from '../definitions/editingInteractionTypes';

const DRAG_THRESHOLD_PX = 3;

export function useSlideEditingInteraction(options: SlideEditingInteractionOptions) {
  const store = useSlidesManualEditingStore();
  const {
    selectedTarget,
    selectedTargets,
    selectionPath,
    translationPreview,
    pendingTranslations,
    pendingVisuals,
    queuedIntents,
  } = storeToRefs(store);
  const hoveredTarget = shallowRef<ManualEditableTarget | null>(null);
  const interactionStore = useSlidesEditingInteractionStore();
  const textEditing = useTextInputSession({ enqueue: options.submitIntent });
  const textPresentations = computed(() => projectTextDraftPresentations(
    options.currentSlide.value?.elements ?? [], interactionStore.textDrafts,
    readHitProjection(), textEditing.target.value?.elementId,
  ));
  const hiddenTextElementIds = computed(() => new Set([
    ...textPresentations.value.map(entry => entry.target.elementId),
    ...(textEditing.target.value ? [textEditing.target.value.elementId] : []),
  ]));
  const marqueeRect = shallowRef<RenderNodeSelectionRect | null>(null);
  const snapGuides = shallowRef<readonly CanvasSnapGuide[]>([]);
  let pointerSession: CanvasPointerGesture | null = null;
  const canMutate = () => options.canMutate?.value ?? true;

  function presentedTargets(): readonly ManualEditableTarget[] {
    return collectPresentedManualTargets(options.currentSlide.value?.elements ?? [], readHitProjection());
  }

  function handlePointerDown(event: PointerEvent, blank = false): void {
    if (!options.canSelect.value || event.button !== 0) return;
    finishKeyboardGesture();
    const point = readPoint(event);
    const slide = options.currentSlide.value;
    if (!point || !slide) return;
    const path = blank ? [] : findManualEditableTargetPathAtPoint(slide.elements, point, readHitProjection());
    const selection = resolveManualClickSelection(path, selectionPath.value, selectedTargets.value.length === 1 ? selectedTarget.value?.elementId : undefined);
    hoveredTarget.value = selection.target;
    const composing = textEditing.composing.value;
    textEditing.requestCommit();
    if (composing) { store.selectTarget(selection.target, path); return; }
    event.preventDefault();
    const base = { pointerId: event.pointerId,
      captureElement: event.currentTarget instanceof HTMLElement ? event.currentTarget : null,
      anchor: point, screenX: event.clientX, screenY: event.clientY, dragged: false };
    if (!selection.target || !selection.clickTarget) {
      const baseline = selectedTargets.value;
      if (!event.shiftKey) store.clearSelection();
      capturePointer(event);
      pointerSession = { ...base, kind: 'marquee', additive: event.shiftKey, baseline };
      return;
    }
    const selected = selectedTargets.value;
    // 多选成员可能是 Frame 子对象；沿命中路径找已选成员，不能让外层 Frame 抢走拖动。
    const member = selected.length > 1 ? path.find(target => selected.some(entry => entry.elementId === target.elementId)) : undefined;
    const target = member ?? selection.target;
    const alreadySelected = selected.some(entry => entry.elementId === target.elementId);
    if (event.shiftKey) {
      // 追加立即生效以便直接拖动；已选成员等松手且未拖动时才移出，Shift 拖动用于锁定方向。
      if (!alreadySelected) selectMany(toggleManualSelection(selected, target));
      beginTranslate(event, base, path, target, alreadySelected ? 'toggle' : 'keep');
      return;
    }
    if (!alreadySelected) store.selectTarget(selection.target, path);
    beginTranslate(event, base, path, member ?? selection.clickTarget, 'select');
  }

  function beginTranslate(
    event: PointerEvent,
    base: Pick<CanvasPointerGesture, 'pointerId' | 'captureElement' | 'anchor' | 'screenX' | 'screenY' | 'dragged'>,
    path: readonly ManualEditableTarget[],
    clickTarget: ManualEditableTarget,
    clickMode: 'select' | 'toggle' | 'keep',
  ): void {
    const targets = selectedTargets.value;
    const ids = new Set(targets.flatMap(target => target.translationElementIds));
    const presented = presentedTargets();
    const bounds = manualSelectionBounds(presented.filter(target => targets.some(selected => selected.elementId === target.elementId)));
    if (!bounds) return;
    capturePointer(event);
    pointerSession = { ...base, kind: 'translate', targets, path, clickTarget, clickMode, bounds,
      peers: presented.filter(target => !ids.has(target.elementId)
        && !target.translationElementIds.some(id => ids.has(id))).map(target => target.bounds),
      canTranslate: canMutate() && targets.every(target => target.capabilities.includes('translate')) };
  }

  /** 单选保留完整命中路径以便逐层深入；多选只保留共同祖先，后续点击停在成员所在层。 */
  function selectMany(targets: readonly ManualEditableTarget[]): void {
    const elements = options.currentSlide.value?.elements ?? [];
    const paths = targets.map(target => findManualEditableTargetPathByElementId(elements, target.elementId));
    store.selectTargets(targets, targets.length === 1 ? paths[0] ?? [] : manualSelectionContext(paths));
  }

  function handlePointerMove(event: PointerEvent): void {
    const session = pointerSession;
    if (!session) { updateHoveredTarget(event); return; }
    if (session.pointerId !== event.pointerId) return;
    const point = readPoint(event);
    if (!point) return;
    event.preventDefault();
    if (!session.dragged && Math.hypot(event.clientX - session.screenX, event.clientY - session.screenY) < DRAG_THRESHOLD_PX) return;
    session.dragged = true;
    if (session.kind === 'marquee') {
      marqueeRect.value = rectFromPoints(session.anchor, point);
      store.selectTargets(collectManualMarqueeSelection(presentedTargets(), marqueeRect.value, session.additive ? session.baseline : []));
      return;
    }
    if (!session.canTranslate) return;
    const snapped = snapCanvasTranslation({ bounds: session.bounds, peers: session.peers,
      slideSize: options.slideSize.value, renderScale: options.renderScale.value,
      delta: { dx: point.x - session.anchor.x, dy: point.y - session.anchor.y }, disabled: event.altKey, axisLock: event.shiftKey });
    snapGuides.value = snapped.guides;
    store.setTranslationPreview({ elementId: session.targets[0].elementId,
      affectedElementIds: session.targets.flatMap(target => target.translationElementIds), ...snapped.delta });
  }

  function submitTranslation(targets: readonly ManualEditableTarget[], gesture: NonNullable<typeof translationPreview.value>): void {
    // 落在编译器坐标格点上，后端才能直接平移已编译快照而不必整稿重编。
    const delta = quantizeManualTranslation(gesture);
    if (delta.dx === 0 && delta.dy === 0) return;
    const operations: SlidesManualEditOperation[] = targets.map(target => ({ op: 'translate_by', target: target.authoringRef,
      targetKind: target.targetKind, delta }));
    options.submitIntent({ operation: operations.length === 1 ? operations[0] : { op: 'batch', operations },
      translationPreviews: [{ ...gesture, ...delta }] });
  }

  function handlePointerUp(event: PointerEvent): void {
    const session = pointerSession;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (session.captureElement?.hasPointerCapture(session.pointerId)) session.captureElement.releasePointerCapture(session.pointerId);
    pointerSession = null;
    marqueeRect.value = null;
    snapGuides.value = [];
    if (session.kind === 'marquee') return;
    const preview = translationPreview.value;
    if (!session.dragged) {
      if (session.clickMode === 'select') store.selectTarget(session.clickTarget, session.path);
      else if (session.clickMode === 'toggle') selectMany(toggleManualSelection(selectedTargets.value, session.clickTarget));
      return;
    }
    store.setTranslationPreview(null);
    if (session.canTranslate && preview) submitTranslation(session.targets, preview);
  }

  function handlePointerCancel(event: PointerEvent): void {
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) return;
    cancelPointerGesture();
    hoveredTarget.value = null;
  }

  function handlePointerLeave(): void {
    if (!pointerSession) hoveredTarget.value = null;
  }

  function handleDoubleClick(event: MouseEvent): void {
    if (!options.canSelect.value || !canMutate()) return;
    const point = readPoint(event);
    const slide = options.currentSlide.value;
    if (!point || !slide) return;
    const path = findManualEditableTargetPathAtPoint(slide.elements, point, readHitProjection());
    const target = path[path.length - 1];
    if (!target?.textEditing) return;
    const editorTarget = createPresentedTextEditingTarget(slide.elements, target, readHitProjection());
    if (!editorTarget) return;
    event.preventDefault();
    store.selectTarget(target, path);
    textEditing.open(editorTarget, textPresentations.value.find(draft => draft.target.elementId === target.elementId));
  }

  function submitVisualOperation(operation: ManualEditingVisualOperation): boolean {
    const target = selectedTarget.value;
    if (!target || !options.canSelect.value) return false;
    const preview = createManualVisualPreview(target, operation);
    if (!preview) return false;
    options.submitIntent({ operation, visualPreviews: [preview] });
    if (operation.op === 'delete_target') {
      hoveredTarget.value = null;
      store.clearSelection();
    }
    return true;
  }

  function deleteSelectedTarget(): boolean {
    if (textEditing.target.value || !options.canSelect.value || !canMutate() || selectedTargets.value.length === 0) return false;
    const operations = selectedTargets.value.map(createManualDeleteOperation);
    if (operations.some(operation => operation === null)) return false;
    const valid = operations.filter(operation => operation !== null);
    const previews = selectedTargets.value.flatMap((target, index) => {
      const preview = createManualVisualPreview(target, valid[index]);
      return preview ? [preview] : [];
    });
    options.submitIntent({ operation: valid.length === 1 ? valid[0] : { op: 'batch', operations: valid }, visualPreviews: previews });
    hoveredTarget.value = null;
    store.clearSelection();
    return true;
  }

  function reconcileSelection(): void {
    const slide = options.currentSlide.value;
    const restored = selectedTargets.value.flatMap(selected => {
      const path = slide ? findManualEditableTargetPathByElementId(slide.elements, selected.elementId) : [];
      const next = path.find(target => target.elementId === selected.elementId);
      return next ? [next] : [];
    });
    selectMany(restored);
    const editingId = textEditing.target.value?.elementId;
    if (editingId && options.currentSlide.value) {
      const editingTarget = findManualEditableTargetPathByElementId(options.currentSlide.value.elements, editingId)
        .find(candidate => candidate.elementId === editingId);
      textEditing.reconcileTarget(editingTarget
        ? createPresentedTextEditingTarget(options.currentSlide.value.elements, editingTarget, readHitProjection())
        : null);
    }
    hoveredTarget.value = null;
  }

  /** 撤销、插入或粘贴呈现后，按作者身份在当前页选中仍存在的对象；新文字框直接进入输入。 */
  function revealRequestedTargets(): void {
    const request = store.revealRequest;
    if (!request) return;
    store.requestReveal(null);
    const found = presentedTargets().filter(target => request.targets.some(ref => ref.editKey === target.authoringRef.editKey
      && (ref.slideKey === undefined || ref.slideKey === target.authoringRef.slideKey)));
    if (found.length === 0) return;
    selectMany(normalizeManualSelection(found));
    const slide = options.currentSlide.value;
    const only = found.length === 1 ? found[0] : undefined;
    if (!request.editText || !only?.textEditing || !slide || !canMutate()) return;
    const editorTarget = createPresentedTextEditingTarget(slide.elements, only, readHitProjection());
    if (editorTarget) textEditing.open(editorTarget, undefined, { selectAll: true });
  }
  watch(() => store.revealRequest, revealRequestedTargets, { flush: 'post' });

  function resetInteraction(): void {
    finishKeyboardGesture();
    cancelPointerGesture();
    hoveredTarget.value = null;
    store.clearSelection();
    textEditing.requestCommit();
  }

  let keyboardTargets: readonly ManualEditableTarget[] = [];

  function finishKeyboardGesture(): void {
    if (keyboardTargets.length === 0) return;
    const targets = keyboardTargets;
    const preview = translationPreview.value;
    keyboardTargets = [];
    store.setTranslationPreview(null);
    if (preview) submitTranslation(targets, preview);
  }

  function cancelPointerGesture(): boolean {
    const session = pointerSession;
    if (!session) return false;
    if (session.captureElement?.hasPointerCapture(session.pointerId)) {
      session.captureElement.releasePointerCapture(session.pointerId);
    }
    if (session.kind === 'marquee') store.selectTargets(session.baseline);
    pointerSession = null;
    marqueeRect.value = null;
    snapGuides.value = [];
    store.setTranslationPreview(null);
    return true;
  }

  /** 长按只改变临时位移，松键/失焦后才产生一个逻辑编辑，避免每个 repeat 都编译。 */
  function handleKeydown(event: KeyboardEvent): boolean {
    if (!options.canSelect.value || !ownsCanvasKeyboard(event) || textEditing.target.value) return false;
    if (event.key === 'Escape') {
      if (keyboardTargets.length > 0) {
        keyboardTargets = [];
        store.setTranslationPreview(null);
      } else if (!cancelPointerGesture()) store.clearSelection();
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      finishKeyboardGesture();
      store.selectTargets(normalizeManualSelection(presentedTargets()));
      return true;
    }
    const targets = selectedTargets.value;
    const target = targets[0];
    if (!target) return false;
    const delta = readCanvasNudge(event);
    // 只读时选区仍在，方向键交还翻页，Delete 不生效。
    if (!canMutate() && (delta || event.key === 'Delete' || event.key === 'Backspace')) return false;
    if (delta) {
      // 选中但不可平移的对象仍拥有方向键，不能意外跳页。
      if (!targets.every(entry => entry.capabilities.includes('translate')) || pointerSession) return true;
      keyboardTargets = targets;
      const previous = translationPreview.value;
      store.setTranslationPreview({ elementId: target.elementId, affectedElementIds: targets.flatMap(entry => entry.translationElementIds),
        dx: (previous?.dx ?? 0) + delta.dx, dy: (previous?.dy ?? 0) + delta.dy });
      return true;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      finishKeyboardGesture();
      return deleteSelectedTarget();
    }
    return false;
  }

  function handleKeyup(event: KeyboardEvent): void {
    if (event.key.startsWith('Arrow')) finishKeyboardGesture();
  }

  function readHitProjection(): ManualEditingHitProjection {
    return {
      projectPreview: options.projectPreview,
      transientTranslation: translationPreview.value,
      pendingTranslations: pendingTranslations.value,
      pendingVisuals: pendingVisuals.value,
      transientVisual: options.visualPreview?.value,
      queuedIntents: queuedIntents.value,
    };
  }

  function updateHoveredTarget(event: Pick<PointerEvent, 'clientX' | 'clientY'>): void {
    const point = readPoint(event);
    const slide = options.currentSlide.value;
    if (!options.canSelect.value || !point || !slide) {
      hoveredTarget.value = null;
      return;
    }
    const path = findManualEditableTargetPathAtPoint(slide.elements, point, readHitProjection());
    hoveredTarget.value = resolveManualClickSelection(
      path,
      selectionPath.value,
      selectedTarget.value?.elementId,
    ).target;
  }

  /** 指针下是否有作者对象；没有时画布可把这次点击交给只带源码定位的 AI 选择。 */
  function hasTargetAt(event: Pick<MouseEvent, 'clientX' | 'clientY'>): boolean {
    const point = readPoint(event);
    const slide = options.currentSlide.value;
    return point !== null && slide !== null && findManualEditableTargetPathAtPoint(slide.elements, point, readHitProjection()).length > 0;
  }

  function readPoint(event: Pick<MouseEvent, 'clientX' | 'clientY'>): SourceSelectionPoint | null {
    const wrapper = options.wrapperRef.value;
    if (!wrapper) return null;
    return resolveSlidePointerPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      wrapperRect: wrapper.getBoundingClientRect(),
      renderScale: options.renderScale.value,
      slideSize: options.slideSize.value,
    });
  }

  return {
    selectedTarget,
    selectedTargets,
    selectionPath,
    translationPreview,
    pendingTranslations,
    pendingVisuals,
    queuedIntents,
    hoveredTarget,
    textEditorTarget: textEditing.target,
    textDraft: textEditing.draft,
    textSessionId: textEditing.sessionId,
    textSelectAll: textEditing.selectAll,
    textPresentations,
    hiddenTextElementIds,
    marqueeRect, snapGuides,
    handleKeydown,
    handleKeyup,
    finishKeyboardGesture,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handlePointerLeave,
    handleDoubleClick,
    hasTargetAt,
    submitVisualOperation,
    deleteSelectedTarget,
    submitTextEdit: textEditing.requestCommit,
    closeTextEditor: textEditing.cancel,
    handleTextCompositionStart: textEditing.beginComposition,
    handleTextCompositionEnd: textEditing.endComposition,
    handleTextEditorEscape: (event: KeyboardEvent) => {
      textEditing.handleEscape(event);
      if (!textEditing.target.value) options.focusCanvas?.();
    },
    handleTextEditorSubmitShortcut: (event: KeyboardEvent) => {
      textEditing.handleCommitShortcut(event);
      if (!textEditing.target.value) options.focusCanvas?.();
    },
    reconcileSelection,
    resetInteraction,
  };
}

function capturePointer(event: PointerEvent): void {
  const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  target?.setPointerCapture(event.pointerId);
}
