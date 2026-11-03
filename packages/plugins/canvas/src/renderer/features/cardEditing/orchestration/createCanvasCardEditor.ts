import { CanvasTextDocumentSchema, canvasAutomaticTextHeight } from '@plugin/canvas/shared';
import type { CanvasCardId } from '@plugin/canvas/shared';
import { requireWritableCanvas, type CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasCardDraft, CanvasCardEditor, CanvasTextEditingLease } from '../definitions/cardEditing';
import { createCardEditingState } from '../store/createCardEditingState';
import { createCanvasTextProtection } from './createCanvasTextProtection';

export function createCanvasCardEditor(session: CanvasDocumentSession): CanvasCardEditor {
  const state = createCardEditingState(), protection = createCanvasTextProtection(session, state.failed);
  let composing = false, generation = 0, disposed = false;
  let active: CanvasTextEditingLease | null = null, pendingSave: Promise<boolean> | null = null;
  const owns = (lease: CanvasTextEditingLease | null, draft: CanvasCardDraft) => active === lease && state.draft.value?.historyGroupId === draft.historyGroupId;
  const readCard = (id: CanvasCardId) => {
    const card = requireWritableCanvas(session.state.snapshot.value).elements.find(element => element.id === id);
    if (!card || card.type !== 'text') throw new Error('这张卡不能进入文字编辑');
    if (card.locked) throw new Error('请先解锁这张卡');
    return card;
  };
  async function finishDraft(draft: CanvasCardDraft, mayFinish: () => boolean) {
    const lease = active; if (!mayFinish()) return false;
    if (lease) await protection.release(lease);
    if (!owns(lease, draft)) return state.draft.value === null;
    if (mayFinish() && state.draft.value?.editSequence === draft.editSequence) { state.clear(); active = null; return true; }
    // 释放RPC期间仍有新输入/切回原卡，不能清掉草稿；恢复的也是该次编辑自己的owner。
    if (lease) {
      await protection.claim(lease);
      if (owns(lease, draft)) protection.start(lease); else await protection.release(lease);
    }
    return false;
  }
  const save = async (finish = false, isCurrent?: () => boolean): Promise<boolean> => {
    const token = generation, mayFinish = isCurrent ?? (() => !disposed && token === generation);
    if (pendingSave) { if (!(await pendingSave)) return false; return save(finish, mayFinish); }
    const draft = state.draft.value, lease = active;
    if (!draft) return true;
    if (composing) return false;
    if (draft.editSequence === draft.savedSequence) return !finish || finishDraft(draft, mayFinish);
    state.beginSave();
    pendingSave = (async () => {
      try {
        const card = session.state.snapshot.value?.elements.find(element => element.id === draft.elementId);
        if (!card || card.type !== 'text') throw new Error('文字卡已被移除，草稿仍保留');
        const result = await session.commit([{
          op: 'update', id: draft.elementId, baseRevision: draft.baseRevision,
          patch: { data: { ...card.data, content: draft.content }, ...(card.data.heightMode === 'auto' && draft.measuredHeight !== null ? { height: draft.measuredHeight } : {}) },
        }], draft.historyGroupId);
        if (!owns(lease, draft)) return true;
        const outcome = result.results[0];
        if (outcome?.status !== 'applied') throw new Error(outcome?.reason ?? '文字修改没有提交，请重试');
        const current = session.state.snapshot.value?.elements.find(element => element.id === draft.elementId);
        if (!current || current.type !== 'text') throw new Error('文字卡已被移除，草稿仍保留');
        state.saved(current.revision, draft.editSequence);
        if (finish && state.draft.value?.editSequence === draft.editSequence) return await finishDraft(draft, mayFinish);
        return !finish || state.draft.value === null;
      } catch (error) {
        state.failed(error instanceof Error ? error.message : String(error)); return false;
      }
    })();
    try { return await pendingSave; } finally { pendingSave = null; }
  };
  return {
    state, save,
    async open(elementId, historyGroupId, signal) {
      const token = ++generation;
      const current = () => !disposed && token === generation && !signal?.aborted;
      if (!current()) return;
      const existing = state.draft.value?.elementId === elementId;
      if (existing && active) return;
      const saved = existing || await save(true, current);
      if (!current()) return;
      if (!saved) throw new Error('当前文字草稿尚未保存');
      readCard(elementId);
      const lease = protection.create(elementId); let accepted = false;
      try {
        await protection.claim(lease);
        if (!current()) return;
        const card = readCard(elementId);
        if (!existing) state.begin(card, historyGroupId ?? crypto.randomUUID());
        active = lease; protection.start(lease); accepted = true;
      } finally { if (!accepted) await protection.release(lease); }
    },
    update(content) { state.update(CanvasTextDocumentSchema.parse(content)); },
    measure(height) { state.measure(canvasAutomaticTextHeight(Math.ceil(height))); },
    setComposing(value) { composing = value; },
    async suspend() { generation += 1; const lease = active; active = null; if (lease) await protection.release(lease); },
    dispose() { disposed = true; generation += 1; active = null; protection.dispose(); },
  };
}
