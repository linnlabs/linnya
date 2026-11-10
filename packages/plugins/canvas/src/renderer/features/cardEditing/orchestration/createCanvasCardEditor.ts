import { createCanvasCardSave } from './createCanvasCardSave';
import { CanvasTextDocumentSchema, canvasAutomaticTextHeight } from '@plugin/canvas/shared';
import type { CanvasCardId } from '@plugin/canvas/shared';
import { requireWritableCanvas, type CanvasDocumentSession } from '../../canvasDocument';
import type {
  CanvasCardDraft,
  CanvasCardEditor,
  CanvasTextEditingLease,
} from '../definitions/cardEditing';
import { createCardEditingState } from '../store/createCardEditingState';
import { createCanvasTextProtection } from './createCanvasTextProtection';
import { canvasText } from '../../localization';

export function createCanvasCardEditor(session: CanvasDocumentSession): CanvasCardEditor {
  const state = createCardEditingState(),
    protection = createCanvasTextProtection(session, state.failed);
  let composing = false,
    generation = 0,
    disposed = false;
  let active: CanvasTextEditingLease | null = null;
  const owns = (lease: CanvasTextEditingLease | null, draft: CanvasCardDraft) =>
    active === lease && state.draft.value?.historyGroupId === draft.historyGroupId;
  const readCard = (id: CanvasCardId) => {
    const card = requireWritableCanvas(session.state.snapshot.value).elements.find(
      element => element.id === id
    );
    if (!card || card.type !== 'text') throw new Error(canvasText('canvas.error.cardNotEditable'));
    if (card.locked) throw new Error(canvasText('canvas.error.cardLocked'));
    return card;
  };
  async function finishDraft(draft: CanvasCardDraft, mayFinish: () => boolean) {
    const lease = active;
    if (!mayFinish()) return false;
    if (lease) await protection.release(lease);
    if (!owns(lease, draft)) return state.draft.value === null;
    if (mayFinish() && state.draft.value?.editSequence === draft.editSequence) {
      state.clear();
      active = null;
      return true;
    }
    // 释放RPC期间仍有新输入/切回原卡，不能清掉草稿；恢复的也是该次编辑自己的owner。
    if (lease) {
      await protection.claim(lease);
      if (owns(lease, draft)) protection.start(lease);
      else await protection.release(lease);
    }
    return false;
  }
  const save = createCanvasCardSave({
    session,
    state,
    owns,
    finishDraft,
    readLease: () => active,
    isComposing: () => composing,
    captureCurrent() {
      const token = generation;
      return () => !disposed && token === generation;
    },
  });
  return {
    state,
    save,
    async open(elementId, historyGroupId, signal) {
      const token = ++generation;
      const current = () => !disposed && token === generation && !signal?.aborted;
      if (!current()) return;
      const existing = state.draft.value?.elementId === elementId;
      if (existing && active) return;
      const saved = existing || (await save(true, current));
      if (!current()) return;
      if (!saved) throw new Error(canvasText('canvas.error.draftUnsaved'));
      readCard(elementId);
      const lease = protection.create(elementId);
      let accepted = false;
      try {
        await protection.claim(lease);
        if (!current()) return;
        const card = readCard(elementId);
        if (!existing) state.begin(card, historyGroupId ?? crypto.randomUUID());
        active = lease;
        protection.start(lease);
        accepted = true;
      } finally {
        if (!accepted) await protection.release(lease);
      }
    },
    update(content) {
      state.update(CanvasTextDocumentSchema.parse(content));
    },
    measure(height) {
      // 与后台测高同一精度（三位小数）；向上取整会让卡片一进编辑就高出不到 1px，保存后还会留下来。
      state.measure(canvasAutomaticTextHeight(Math.round(height * 1000) / 1000));
    },
    setComposing(value) {
      composing = value;
    },
    async suspend() {
      generation += 1;
      const lease = active;
      active = null;
      if (lease) await protection.release(lease);
    },
    dispose() {
      disposed = true;
      generation += 1;
      active = null;
      protection.dispose();
    },
  };
}
