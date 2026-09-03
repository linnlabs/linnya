/**
 * useToolbarState.js
 * 
 * 提供表格工具栏状态管理的组合式函数
 * 处理下拉菜单状态、按钮启用/禁用状态等
 */
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { canMergeCells, canSplitCell } from '../../commands/tableCellCommands';

/**
 * 工具栏状态管理钩子
 * @param {Object} options - 配置选项
 * @param {import('vue').ComputedRef} options.editor - 编辑器实例的计算属性
 * @returns {Object} 工具栏状态和管理方法
 */
export function useToolbarState({ editor }) {
  // 下拉菜单状态
  const insertDropdownOpen = ref(false);
  const deleteDropdownOpen = ref(false);
  const aiDropdownOpen = ref(false);
  const alignDropdownOpen = ref(false);

  // 按钮状态的计算属性
  const canMergeCellsState = computed(() => {
    if (!editor.value || !editor.value.can) return false;
    try {
      return editor.value.can().mergeCells();
    } catch (error) {
      console.error('[useToolbarState] canMergeCells 检查错误:', error);
    return false;
    }
  });

  const canSplitCellState = computed(() => {
    if (!editor.value || !editor.value.can) return false;
    try {
      return editor.value.can().splitCell();
    } catch (error) {
      console.error('[useToolbarState] canSplitCell 检查错误:', error);
    return false;
    }
  });

  const canDeleteRowState = computed(() => {
    if (editor.value && editor.value.can) {
      return editor.value.can().deleteRow();
    }
    return false;
  });

  const canDeleteColumnState = computed(() => {
    if (editor.value && editor.value.can) {
      return editor.value.can().deleteColumn();
    }
    return false;
  });

  const canAddRowBeforeState = computed(() => {
    if (editor.value && editor.value.can) {
      return editor.value.can().addRowBefore();
    }
    return false;
  });

  const canAddRowAfterState = computed(() => {
    if (editor.value && editor.value.can) {
      return editor.value.can().addRowAfter();
    }
    return false;
  });

  const canAddColumnBeforeState = computed(() => {
    if (editor.value && editor.value.can) {
      return editor.value.can().addColumnBefore();
    }
    return false;
  });

  const canAddColumnAfterState = computed(() => {
    if (editor.value && editor.value.can) {
      return editor.value.can().addColumnAfter();
    }
    return false;
  });

  // 切换菜单函数 - 确保只有一个菜单打开
  const toggleMenu = (menuType) => {
    // 先关闭所有菜单
    closeAllMenus();
    
    // 然后打开指定菜单
    switch(menuType) {
      case 'insert':
        insertDropdownOpen.value = true;
        break;
      case 'delete':
        deleteDropdownOpen.value = true;
        break;
      case 'ai':
        aiDropdownOpen.value = true;
        break;
      case 'align':
        alignDropdownOpen.value = true;
        break;
    }
  };

  // 关闭所有菜单
  const closeAllMenus = () => {
    insertDropdownOpen.value = false;
    deleteDropdownOpen.value = false;
    aiDropdownOpen.value = false;
    alignDropdownOpen.value = false;
  };

  // 点击外部关闭下拉菜单
  const handleClickOutside = (event) => {
    if (!event.target.closest('.toolbar-group')) {
      closeAllMenus();
    }
  };

  // 当编辑器选区变化时，如果菜单是打开的，则关闭它们
  watch(() => editor.value?.state?.selection, (selection) => {
    if (insertDropdownOpen.value || alignDropdownOpen.value) {
      closeAllMenus();
    }
  }, { deep: true });

  // 挂载和卸载时处理事件监听
  onMounted(() => {
    document.addEventListener('click', handleClickOutside);
  });

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside);
  });

  return {
    // 菜单状态
    insertDropdownOpen,
    deleteDropdownOpen,
    aiDropdownOpen,
    alignDropdownOpen,
    
    // 按钮状态
    canMergeCellsState,
    canSplitCellState,
    canDeleteRowState,
    canDeleteColumnState,
    canAddRowBeforeState,
    canAddRowAfterState,
    canAddColumnBeforeState,
    canAddColumnAfterState,
    
    // 方法
    toggleMenu,
    closeAllMenus
  };
} 