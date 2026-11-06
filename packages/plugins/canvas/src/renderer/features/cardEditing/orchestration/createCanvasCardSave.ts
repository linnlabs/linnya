import type { CanvasCardSaveOptions, CanvasCardSave } from '../definitions/cardEditing';

/** 保存串行屏障与成功回执接纳；编辑打开/关闭及lease归属由编辑器生命周期提供。 */
export function createCanvasCardSave(options: CanvasCardSaveOptions): CanvasCardSave {
  const { session, state, owns, finishDraft } = options;
  let pendingSave: Promise<boolean> | null = null;
  const save = async (finish = false, isCurrent?: () => boolean): Promise<boolean> => {
    const mayFinish = isCurrent ?? options.captureCurrent();
    if (pendingSave) {
      if (!(await pendingSave)) return false;
      return save(finish, mayFinish);
    }
    const draft = state.draft.value,
      lease = options.readLease();
    if (!draft) return true;
    if (options.isComposing()) return false;
    if (draft.editSequence === draft.savedSequence) return !finish || finishDraft(draft, mayFinish);
    state.beginSave();
    pendingSave = (async () => {
      try {
        const card = session.state.snapshot.value?.elements.find(
          element => element.id === draft.elementId
        );
        if (!card || card.type !== 'text') throw new Error('文字卡已被移除，草稿仍保留');
        const result = await session.commit(
          [
            {
              op: 'update',
              id: draft.elementId,
              baseRevision: draft.baseRevision,
              patch: {
                data: { ...card.data, content: draft.content },
                ...(card.data.heightMode === 'auto' && draft.measuredHeight !== null
                  ? { height: draft.measuredHeight }
                  : {}),
              },
            },
          ],
          draft.historyGroupId
        );
        if (!owns(lease, draft)) return true;
        const outcome = result.results[0];
        if (outcome?.status !== 'applied')
          throw new Error(outcome?.reason ?? '文字修改没有提交，请重试');
        const current = session.state.snapshot.value?.elements.find(
          element => element.id === draft.elementId
        );
        if (!current || current.type !== 'text') throw new Error('文字卡已被移除，草稿仍保留');
        state.saved(current.revision, draft.editSequence);
        if (finish && state.draft.value?.editSequence === draft.editSequence)
          return await finishDraft(draft, mayFinish);
        return !finish || state.draft.value === null;
      } catch (error) {
        state.failed(error instanceof Error ? error.message : String(error));
        return false;
      }
    })();
    try {
      return await pendingSave;
    } finally {
      pendingSave = null;
    }
  };
  return save;
}
