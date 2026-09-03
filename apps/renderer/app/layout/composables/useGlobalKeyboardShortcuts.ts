/**
 * 全局键盘快捷键处理 composable
 * 
 * 职责：
 * - 处理全局快捷键（保存、查找等）
 * - 管理键盘事件监听器的生命周期
 */

import { onMounted, onBeforeUnmount } from 'vue';
import { useUIStore } from '@/shared/stores/ui';
import { useFileStore } from '@/shared/stores/file';
import { useNotificationStore } from '@/app/notification';
import { requestSave } from '@/domains/workspace/services/file-manager/index';
import { useLayoutLocalization } from '@/app/layout/composables/useLayoutLocalization';

/**
 * 全局键盘快捷键 composable
 * 
 * 自动在组件挂载时注册监听器，卸载时清理
 */
export function useGlobalKeyboardShortcuts() {
  const uiStore = useUIStore();
  const fileStore = useFileStore();
  const notificationStore = useNotificationStore();
  const { layoutMessage } = useLayoutLocalization();

  /**
   * 全局快捷键事件处理器
   */
  const handleGlobalKeyDown = async (event: KeyboardEvent) => {
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    const isModF = (isMac ? event.metaKey : event.ctrlKey) && event.key === 'f';
    const isModS = (isMac ? event.metaKey : event.ctrlKey) && event.key === 's';
    
    // 处理保存快捷键 (Ctrl+S / Cmd+S)
    if (isModS) {
      event.preventDefault(); // 阻止浏览器默认的保存行为
      await handleSaveShortcut();
      return;
    }
    
    // 处理查找快捷键 (Ctrl+F / Cmd+F)
    if (isModF) {
      handleFindShortcut(event);
    }
  };

  /**
   * 处理保存快捷键
   */
  const handleSaveShortcut = async () => {
    // 检查是否有文件打开
    if (!fileStore.hasOpenFile) {
      notificationStore.show(layoutMessage('layout.shortcuts.save.noOpenFile'), 'warning', 2000);
      return;
    }
    
    // 如果正在保存，则提示用户
    if (fileStore.isSaving) {
      notificationStore.show(layoutMessage('layout.shortcuts.save.saving'), 'info', 1500);
      return;
    }
    
    try {
      await requestSave('manual');
    } catch (error) {
      console.error('[useGlobalKeyboardShortcuts] 调用 requestSave(manual) 时发生未预期的错误:', error);
      notificationStore.show(
        layoutMessage('layout.shortcuts.save.unexpectedError'),
        'error',
        3000,
      );
    }
  };

  /**
   * 处理查找快捷键
   */
  const handleFindShortcut = (event: KeyboardEvent) => {
    // 检查当前焦点元素
    const activeElement = document.activeElement as HTMLElement | null;
    const tagName = activeElement?.tagName?.toLowerCase();
    
    // 如果焦点在输入框、文本域或其他可编辑元素中，检查是否在编辑器内
    if (tagName === 'input' || tagName === 'textarea' || activeElement?.isContentEditable) {
      // 检查是否在编辑器内（ProseMirror 编辑器）
      const isInEditor = activeElement?.closest('.ProseMirror');
      if (!isInEditor) {
        // 不在编辑器内的输入框，不处理
        return;
      }
    }
    
    // 打开查找替换面板
    event.preventDefault();
    const editor = uiStore.getEditor();
    const store = editor?.storage?.findReplaceStore;
    if (store) {
      store.showPanel();
    }
  };

  // 生命周期：挂载时注册，卸载时清理
  onMounted(() => {
    window.addEventListener('keydown', handleGlobalKeyDown);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleGlobalKeyDown);
  });

  return {
    handleGlobalKeyDown,
    handleSaveShortcut,
    handleFindShortcut,
  };
}
