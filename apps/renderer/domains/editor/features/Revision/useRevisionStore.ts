import type { Editor } from '@tiptap/core';
import type { RevisionStore } from './definitions/revision';
import { createRevisionRuntime } from './orchestration/createRevisionRuntime';

const instances = new WeakMap<Editor, RevisionStore>();
/** 同一 Editor 共用投影运行时；文档身份和生命周期由 document-session 绑定。 */
export function useRevisionStore(editor: Editor): RevisionStore {
  const current = instances.get(editor);
  if (current) return current;
  const runtime = createRevisionRuntime(editor);
  instances.set(editor, runtime);
  return runtime;
}
export type * from './definitions/revision';
