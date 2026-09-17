import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { setPendingProjectionBatch } from '../store/pendingProjectionBatch';

/** 由 Editor 串行队列调用；批次内推进真实 state，DOM 和插件视图只协调一次。 */
export async function batchPendingDispatches(
  editor: Editor,
  apply: () => Promise<unknown>,
  options?: { onFlush?: (durationMs: number) => void },
): Promise<void> {
  const view = editor.view;
  const editable = editor.isEditable;
  // 异步解析期间不能让用户输入混入投影事务，否则输入会被当作派生更新而漏记 dirty。
  editor.setEditable(false, false);
  const renderedState = view.state;
  const originalUpdateState = view.updateState;
  let latestState: EditorState = renderedState;
  setPendingProjectionBatch(editor, true);
  view.updateState = state => {
    latestState = state;
    view.state = state;
  };
  try {
    await apply();
  } finally {
    view.updateState = originalUpdateState;
    // updateState 需要从真正渲染过的状态计算插件/选择区变化，不能把批次末态当作旧状态。
    view.state = renderedState;
    try {
      const started = performance.now();
      view.updateState(latestState);
      options?.onFlush?.(performance.now() - started);
    } finally {
      setPendingProjectionBatch(editor, false);
      if (!editor.isDestroyed) editor.setEditable(editable, false);
    }
  }
}
