import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import katex from 'katex';
import { TextSelection, NodeSelection } from 'prosemirror-state';

export const useLatexEditorStore = defineStore('latexEditor', () => {
  // --- State --- 
  const isPanelVisible = ref(false);
  const targetNodeId = ref(null);
  const currentSource = ref('');
  const originalSource = ref('');
  const panelPosition = ref({ top: 0, left: 0 });
  const referenceElement = ref(null); // DOM element for Floating UI
  const editorInstance = ref(null); // 存储编辑器实例引用
  const pendingOpenNodeId = ref(null); // ++ 新增：用于意图驱动的自动打开 ++

  // --- Computed for validation (needed for submit) ---
  const isSourceValid = computed(() => {
    const source = currentSource.value.trim();
    if (source === '') {
        return true; // Allow empty submission
    }
    try {
        // Always use renderToString with throwOnError for reliable validation
        katex.renderToString(source, { 
            throwOnError: true, 
            displayMode: true // Match rendering mode if needed
        });
        return true; // If renderToString doesn't throw, it's valid
    } catch (e) {
        return false; // If it throws, it's invalid
    }
  });

  // --- Actions --- 

  /**
   * 显示 LaTeX 编辑面板
   * @param {string} nodeId - 目标节点的 ID
   * @param {string} initialSource - 初始 LaTeX 源码
   * @param {HTMLElement | null} refEl - 用于定位的参考 DOM 元素
   * @param {Object | null} editor - 编辑器实例
   */
  function showPanel(nodeId, initialSource, refEl, editor = null) {
    
    targetNodeId.value = nodeId;
    currentSource.value = initialSource || '';
    originalSource.value = initialSource || '';
    referenceElement.value = refEl;
    if (editor) {
      editorInstance.value = editor;
    } else {
      console.warn('[LatexStore] Received null or undefined editor instance.');
      if (!editorInstance.value) {
          console.warn('[LatexStore] No editor instance available globally either.');
      }
    }
    isPanelVisible.value = true;
  }

  /**
   * ++ 新增：设置待打开面板的节点ID ++
   * @param {string} nodeId 
   */
  function setPendingOpenNodeId(nodeId) {
    pendingOpenNodeId.value = nodeId;
  }

  /**
   * ++ 新增：清除待打开面板的节点ID ++
   */
  function clearPendingOpenNodeId() {
    pendingOpenNodeId.value = null;
  }

  /**
   * 隐藏 LaTeX 编辑面板并重置状态 (用于提交成功或外部关闭)
   */
  async function hidePanel() {    
    isPanelVisible.value = false;
    await new Promise(resolve => setTimeout(resolve, 10)); 
    targetNodeId.value = null;
    currentSource.value = '';
    originalSource.value = '';
    panelPosition.value = { top: 0, left: 0 };
    referenceElement.value = null;
  }

  /**
   * 取消编辑，恢复原始状态并隐藏面板
   */
  async function cancelEdit() {
    currentSource.value = originalSource.value;
    isPanelVisible.value = false;
    
    await new Promise(resolve => setTimeout(resolve, 10)); 
    targetNodeId.value = null;
    originalSource.value = '';
    panelPosition.value = { top: 0, left: 0 };
    referenceElement.value = null;
  }

  /**
   * 设置编辑器实例
   * @param {Object} editor 编辑器实例
   */
  function setEditor(editor) {
    editorInstance.value = editor;
  }

  /**
   * 更新面板中的当前源码 (通常由面板组件调用)
   * @param {string} newSource 
   */
  function updateSource(newSource) {
    currentSource.value = newSource;
  }

  /**
   * 更新面板的计算位置 (通常由面板组件调用)
   * @param {{top: number, left: number}} position 
   */
  function updatePosition(position) {
    panelPosition.value = position;
  }

  /**
   * 设置用于定位的参考元素 (通常由触发者调用)
   * @param {HTMLElement | null} refEl 
   */
   function setReferenceElement(refEl) {
     referenceElement.value = refEl;
   }

  /**
   * 提交当前 LaTeX 源码 - 构建并派发单一事务
   * @returns {boolean} - 返回事务是否被派发
   */
  async function submitCurrentLatex() {
    
    const editor = editorInstance.value; 
    const source = currentSource.value; 
    const nodeId = targetNodeId.value; 

    if (!editor) { 
      console.error('[LatexStore] Submission aborted: Editor instance not available.');
      return false; 
    }
    if (!isSourceValid.value) {
        console.warn('[LatexStore] Submission aborted: Invalid LaTeX source.');
        return false; 
    }
    
    const { state } = editor;
    const { tr, selection } = state;

    if (!(selection instanceof NodeSelection) ||
        (selection.node.type.name !== 'inlineLatex' && selection.node.type.name !== 'latexBlock') ||
        selection.node.attrs.id !== nodeId ) {
      console.warn(`[LatexStore] Submission check failed: Selection is not the target NodeSelection`);
      return false;
    }

    try {
      const pos = selection.from;
      const nodeSize = selection.node.nodeSize;

      const newNodeAttrs = { ...selection.node.attrs, latexSource: source };
      tr.setNodeMarkup(pos, undefined, newNodeAttrs);

      const endPos = pos + nodeSize; 
      const mappedEndPos = tr.mapping.map(endPos);

      // --- 修改开始：使用 Selection.near 查找合适的光标位置 ---
      const { Selection } = await import('prosemirror-state'); // 动态导入 Selection
      const $pos = tr.doc.resolve(mappedEndPos);
      const newSelection = Selection.near($pos); // 使用 Selection.near
      tr.setSelection(newSelection);
      // --- 修改结束 ---

      tr.scrollIntoView();

      editor.view.dispatch(tr);
      
      return true; 

    } catch (error) {
      console.error('[LatexStore] Error building or dispatching transaction:', error);
      return false; 
    }
  }

  // --- Return state and actions ---
  return {
    isPanelVisible,
    targetNodeId,
    currentSource,
    originalSource,
    panelPosition,
    referenceElement,
    editorInstance,
    pendingOpenNodeId, // ++ 导出状态
    // Computed (readonly)
    isSourceValid, 
    // Actions
    showPanel,
    hidePanel,
    cancelEdit,
    updateSource,
    updatePosition,
    setReferenceElement,
    setEditor,
    submitCurrentLatex,
    setPendingOpenNodeId, // ++ 导出
    clearPendingOpenNodeId, // ++ 导出
  };
}); 