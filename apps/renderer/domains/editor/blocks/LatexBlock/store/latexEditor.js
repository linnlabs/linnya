import { defineStore } from 'pinia';
import { ref, shallowRef, computed } from 'vue';
import { isLatexSourceValid } from '../functions/isLatexSourceValid';

export const useLatexEditorStore = defineStore('latexEditor', () => {
  // --- State ---
  const isPanelVisible = ref(false);
  const targetNodeId = ref(null);
  const currentSource = ref('');
  const originalSource = ref('');
  const panelPosition = ref({ top: 0, left: 0 });
  const referenceElement = ref(null); // DOM element for Floating UI
  // Editor/ProseMirror 依赖对象身份，技术实例不能被深层响应式代理。
  const editorInstance = shallowRef(null);
  const pendingOpenNodeId = ref(null); // ++ 新增：用于意图驱动的自动打开 ++

  // --- Computed for validation (needed for submit) ---
  const isSourceValid = computed(() => isLatexSourceValid(currentSource.value));

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

  function getEditor() {
    return editorInstance.value;
  }
  function setPanelVisible(visible) {
    isPanelVisible.value = visible;
  }
  function resetHiddenPanel() {
    targetNodeId.value = null;
    originalSource.value = '';
    panelPosition.value = { top: 0, left: 0 };
    referenceElement.value = null;
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
    getEditor,
    setPanelVisible,
    resetHiddenPanel,
    // Actions
    showPanel,
    updateSource,
    updatePosition,
    setReferenceElement,
    setEditor,
    setPendingOpenNodeId, // ++ 导出
    clearPendingOpenNodeId, // ++ 导出
  };
});
