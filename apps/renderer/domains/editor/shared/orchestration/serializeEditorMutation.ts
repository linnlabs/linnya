import type { Editor } from '@tiptap/core';

const queues = new WeakMap<Editor, Promise<unknown>>();

/** 文档装载、投影和提交共享同一队列，禁止跨 await 交错修改同一个 EditorState。 */
export async function serializeEditorMutation<T>(editor: Editor, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(editor) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  queues.set(editor, current);
  try { return await current; }
  finally { if (queues.get(editor) === current) queues.delete(editor); }
}
