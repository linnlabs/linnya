import { useFileStore } from '../../../stores/file'; // 导入 File Store
import { useNotificationStore } from '@/app/notification';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';

/**
 * 处理保存快捷键 (Ctrl+S / Cmd+S)
 * @param {Object} context - 包含 view, event, editor 等的对象
 * @returns {boolean} - 如果事件被处理则返回 true，否则返回 false
 */
export const handleSaveShortcut = ({ event, editor }) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault(); // 阻止浏览器默认的保存行为

    const fileStore = useFileStore();
    const notificationStore = useNotificationStore();

    // 检查是否有文件打开
    if (!fileStore.hasOpenFile) {
      notificationStore.show(resolveCurrentEditorMessage('editor.shortcuts.save.noOpenFile'), 'warning', 2000);
      return true; // 事件已处理
    }

    // 如果正在保存，则提示用户
    if (fileStore.isSaving) {
      notificationStore.show(resolveCurrentEditorMessage('editor.shortcuts.save.saving'), 'info', 1500);
      return true; // 事件已处理
    }

    // 调用 fileStore 中的核心保存逻辑
    fileStore.saveCurrentFileIfNeeded(editor, 'manual')
      .then(saveAttempted => {
        if (saveAttempted) {
          // 保存尝试后的通知已经在 saveCurrentFileIfNeeded 内部处理了
          // 这里可以根据需要添加额外的特定于快捷键的逻辑，但通常不需要
        } else {
          // 如果 saveCurrentFileIfNeeded 返回 false，说明由于某些条件不满足（例如编辑器不可用）而未尝试保存
          // 这种情况也应该在 saveCurrentFileIfNeeded 内部处理通知，或者如 "manual save, not dirty" 时已处理
        }
      })
      .catch(error => {
        // 理论上 saveCurrentFileIfNeeded 内部会捕获并处理错误，这里作为额外防护
        console.error('[FileKeys] 调用 saveCurrentFileIfNeeded 时发生未预期的顶级错误:', error);
        notificationStore.show(
          resolveCurrentEditorMessage('editor.shortcuts.save.unexpectedError'),
          'error',
          3000,
        );
      });

    return true; // 明确表示事件已被处理
  }

  return false; // 不是 Ctrl+S/Cmd+S，未处理
};
