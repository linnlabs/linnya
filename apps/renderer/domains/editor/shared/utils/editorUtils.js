/**
 * 从编辑器实例收集用于保存的数据。
 * @param {object} editor - Tiptap 编辑器实例。
 * @returns {object | null} 包含版本、编辑器内容和注解的对象，如果无法收集则返回 null。
 */
export function gatherEditorDataForSave(editor) {
  if (!editor) {
    console.error('[EditorUtils] 无法收集保存数据：编辑器实例不可用。');
    return null;
  }

  // 假设 editor 实例上存在 annotationStore 并且有 getCurrentAnnotations 方法
  const annotationStoreInstance = editor.annotationStore;

  if (!annotationStoreInstance || typeof annotationStoreInstance.getCurrentAnnotations !== 'function') {
    console.error('[EditorUtils] 无法收集保存数据：编辑器实例上缺少 annotationStore 或 getCurrentAnnotations 方法。');
    return null;
  }

  try {
    const editorContent = editor.getJSON(); // 获取编辑器核心内容
    const annotationsFromStore = annotationStoreInstance.getCurrentAnnotations(); // 获取注解信息
    
    // 确保注解是纯对象，以便通过 IPC 传递
    const plainAnnotations = JSON.parse(JSON.stringify(annotationsFromStore)); 

    return { version: 1, editorContent, annotations: plainAnnotations };
  } catch (error) {
    console.error('[EditorUtils] 收集保存数据时出错:', error);
    return null;
  }
} 