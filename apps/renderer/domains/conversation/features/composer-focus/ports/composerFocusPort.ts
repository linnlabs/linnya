/** 输入框仅注册聚焦能力；插件和app都看不到Tiptap实例。 */
const participants = new Map<symbol, () => boolean>();
export function registerComposerInputFocus(focus: () => boolean): () => void {
  const id = Symbol('composer-focus');
  participants.set(id, focus);
  return () => { participants.delete(id); };
}
export function focusRegisteredComposerInput(): boolean {
  for (const focus of [...participants.values()].reverse()) if (focus()) return true;
  return false;
}
