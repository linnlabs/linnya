export interface EditorViewDomOwner {
  readonly isDestroyed: boolean
  readonly view: {
    readonly dom: HTMLElement
  }
}

/**
 * Tiptap v3 在 Editor 未挂载或销毁后会让 `view` 返回占位 Proxy；访问 `view.dom` 会直接抛错。
 * 所有 Revision UI 生命周期回调必须先经过这个边界，再保存或读取真实 DOM 引用。
 */
export function readMountedEditorViewDom(
  editor: EditorViewDomOwner | null | undefined
): HTMLElement | null {
  if (!editor || editor.isDestroyed) return null
  return editor.view.dom
}
