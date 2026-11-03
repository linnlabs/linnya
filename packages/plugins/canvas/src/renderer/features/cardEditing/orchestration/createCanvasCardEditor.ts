import { CanvasTextDocumentSchema, canvasAutomaticTextHeight } from '@plugin/canvas/shared';
import type { CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasDocumentSession } from '../../canvasDocument';
import type { CanvasCardEditor } from '../definitions/cardEditing';
import { createCardEditingState } from '../store/createCardEditingState';

export function createCanvasCardEditor(session: CanvasDocumentSession): CanvasCardEditor {
  const state = createCardEditingState();
  let composing = false;
  let renewal: ReturnType<typeof setInterval> | null = null;
  let pendingSave: Promise<boolean> | null = null;
  const stopRenewal = () => { if (renewal) clearInterval(renewal); renewal = null; };
  const release = async (elementId: CanvasCardId) => { stopRenewal(); await session.protect(elementId, [], 'text'); };
  const save = async (finish = false): Promise<boolean> => {
    if (pendingSave) { if (!(await pendingSave)) return false; return save(finish); }
    const draft = state.draft.value;
    if (!draft) return true;
    if (composing) return false;
    if (draft.editSequence === draft.savedSequence) {
      if (finish) { await release(draft.elementId); state.clear(); }
      return true;
    }
    state.beginSave();
    pendingSave = (async () => {
      try {
        const card = session.state.snapshot.value?.elements.find(element => element.id === draft.elementId);
        if (!card || card.type !== 'text') throw new Error('文字卡已被移除，草稿仍保留');
        const result = await session.commit([{
          op: 'update', id: draft.elementId, baseRevision: draft.baseRevision,
          patch: { data: { ...card.data, content: draft.content }, ...(card.data.heightMode === 'auto' && draft.measuredHeight !== null ? { height: draft.measuredHeight } : {}) },
        }], draft.historyGroupId);
        if (state.draft.value?.historyGroupId !== draft.historyGroupId) return true;
        const outcome = result.results[0];
        if (outcome?.status !== 'applied') throw new Error(outcome?.reason ?? '文字修改没有提交，请重试');
        const current = session.state.snapshot.value?.elements.find(element => element.id === draft.elementId);
        if (!current || current.type !== 'text') throw new Error('文字卡已被移除，草稿仍保留');
        state.saved(current.revision, draft.editSequence);
        if (finish && state.draft.value?.editSequence === draft.editSequence) {
          await release(draft.elementId); state.clear();
        }
        return !finish || state.draft.value === null;
      } catch (error) {
        state.failed(error instanceof Error ? error.message : String(error));
        return false;
      }
    })();
    try { return await pendingSave; } finally { pendingSave = null; }
  };
  return {
    state, save,
    async open(elementId, historyGroupId) {
      if (state.draft.value?.elementId === elementId) return;
      if (!(await save(true))) throw new Error('当前文字草稿尚未保存');
      const card = session.state.snapshot.value?.elements.find(element => element.id === elementId);
      if (!card || card.type !== 'text') throw new Error('这张卡不能进入文字编辑');
      if (card.locked) throw new Error('请先解锁这张卡');
      await session.protect(elementId, ['data', 'height'], 'text');
      state.begin(card, historyGroupId ?? crypto.randomUUID());
      renewal = setInterval(() => {
        if (state.draft.value?.elementId !== elementId) return;
        void session.protect(elementId, ['data', 'height'], 'text').catch(error => state.failed(error instanceof Error ? error.message : String(error)));
      }, 2000);
    },
    update(content) { state.update(CanvasTextDocumentSchema.parse(content)); },
    measure(height) { state.measure(canvasAutomaticTextHeight(Math.ceil(height))); },
    setComposing(value) { composing = value; },
    async suspend() { const draft = state.draft.value; if (draft) await release(draft.elementId); },
    dispose() { stopRenewal(); },
  };
}
