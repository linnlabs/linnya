import type { CanvasEdge } from '@plugin/canvas/shared';
import type { CanvasConnectionLabelEditingOptions } from '../definitions/canvasConnections';

/** 标签保存屏障与字段保护同属一次编辑；失败保留草稿，迟到结果不结束下一次草稿。 */
export function createCanvasConnectionLabelEditing(options: CanvasConnectionLabelEditingOptions) {
  const { session, state, patch, report } = options;
  let pending: Promise<boolean> | null = null;
  const release = async () => {
    const id = state.label.value?.edge.id;
    if (id && session.state.snapshot.value) await session.protect(id, [], 'line-label');
  };
  async function save(): Promise<boolean> {
    if (pending) return pending;
    const draft = state.label.value;
    if (!draft) return true;
    pending = (async () => {
      try {
        if (draft.value !== draft.edge.label) await patch(draft.edge, { label: draft.value });
        if (state.label.value?.identity !== draft.identity) return true;
        await release();
        state.endLabel();
        return true;
      } catch (failure) {
        report(failure);
        return false;
      }
    })();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  }
  return {
    release,
    save,
    async begin(edge: CanvasEdge | null) {
      if (!edge || edge.locked || state.label.value) return;
      await session.protect(edge.id, ['label'], 'line-label');
      state.beginLabel(edge);
    },
    cancel() {
      void release().catch(report);
      state.endLabel();
    },
  };
}
