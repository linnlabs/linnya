/**
 * 从编辑器实例收集用于保存的数据。
 * @param {object} editor - Tiptap 编辑器实例。
 * @returns {object | null} 包含版本和编辑器内容的对象，如果无法收集则返回 null。
 */
export function gatherEditorDataForSave(editor) {
  if (!editor) {
    console.error('[EditorUtils] 无法收集保存数据：编辑器实例不可用。');
    return null;
  }

  try {
    return { version: 1, editorContent: editor.getJSON() };
  } catch (error) {
    console.error('[EditorUtils] 收集保存数据时出错:', error);
    return null;
  }
}
