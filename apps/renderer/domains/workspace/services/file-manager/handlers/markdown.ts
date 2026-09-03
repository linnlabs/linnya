/**
 * @file Markdown 文件类型的 lifecycle handler
 * 
 * @description
 * 此模块实现 Markdown 文档的打开和保存逻辑。
 * 
 * 职责:
 * - 从后端加载 Markdown 文档内容
 * - 挂载编辑器（通过 EditorContext）
 * - 序列化并保存文档内容到后端
 * - 处理保存失败、通知等细节
 * 
 * 设计说明:
 * 此 handler 需要与 `EditorContext` 组件协作。
 * - 打开时: 通过 workspaceGateway 加载内容，编辑器自动挂载（通过 fileStore.setFilePath 触发）
 * - 保存时: 从全局编辑器实例获取内容，序列化后通过 workspaceGateway 保存
 */

import {
  isFileSessionOpenCancelledError,
  throwIfFileSessionOpenCancelled,
  type FileTypeLifecycleHandler,
  type FileSessionDescriptor,
  type FileSaveContext,
} from '../index';
import { useFileStore } from '../../../../../shared/stores/file';
import { useUIStore } from '../../../../../shared/stores/ui';
import { useNotificationStore } from '@/app/notification';
import { getMarkdownDocumentEditorRuntimePort } from '../../../../../shared/ports/markdownDocumentEditorRuntimePort';
import { workspaceGateway } from '../../../../../shared/ipc/workspaceGateway';
import { documentLoaderService } from '@app/services/documentLoaderService';
import { serializeRevisionBaselineForSave } from '../../../../editor/features/Revision/functions/serializeRevisionBaselineForSave';
import { resolveCurrentWorkspaceMessage } from '../../../functions/resolveCurrentWorkspaceMessage';

/**
 * Markdown 文件 Handler 实现
 */
export const markdownHandler: FileTypeLifecycleHandler = {
  type: 'markdown',

  /**
   * 打开 Markdown 文档
   * 
   * 流程:
   * 1. 调用 workspaceGateway 从后端加载文档
   * 2. 检查 EditorContext 是否已挂载
   * 3. EditorContext 会监听 fileStore.currentFilePath 的变化，自动加载内容到编辑器
   */
  async open(session: FileSessionDescriptor): Promise<void> {
    const fileStore = useFileStore();
    const uiStore = useUIStore();
    const notificationStore = useNotificationStore();

    try {
      fileStore.setLoading(true);
      console.log(`[MarkdownHandler] Opening markdown document: ${session.documentId}`);

      // 中文说明：file-manager 只负责文件生命周期，不再根据 UI 视图决定导航。
      // 文档 surface 的位置与挂载由 workspaceNavigation 在调用 activateFileSession 前完成。
      const editor = await getMarkdownDocumentEditorRuntimePort().waitForReadyEditor({
        signal: session.openSignal,
      });
      throwIfFileSessionOpenCancelled(session);

      await documentLoaderService.loadDocument({
        documentId: session.documentId,
        documentName: session.displayName ?? resolveCurrentWorkspaceMessage('workspace.fileManager.markdown.untitledDocument'),
        editor,
        stores: { fileStore, uiStore, notificationStore },
        documentType: 'markdown',
        throwIfCancelled: () => throwIfFileSessionOpenCancelled(session),
      });
      throwIfFileSessionOpenCancelled(session);

      await workspaceGateway['notify-document-opened']({ documentId: session.documentId });
      throwIfFileSessionOpenCancelled(session);
      fileStore.setDirty(false);
    } catch (error) {
      if (isFileSessionOpenCancelledError(error)) {
        throw error;
      }
      console.error('[MarkdownHandler] Failed to open markdown document:', error);
      notificationStore.show(
        resolveCurrentWorkspaceMessage('workspace.fileManager.markdown.openFailed'),
        'error',
        3000,
      );
      throw error;
    } finally {
      fileStore.setLoading(false);
    }
  },

  /**
   * 保存 Markdown 文档
   * 
   * 流程:
   * 1. 获取当前编辑器实例
   * 2. 从编辑器获取 JSON 内容
   * 3. 序列化内容
   * 4. 通过 workspaceGateway 调用后端保存
   * 5. 更新 dirty 状态和显示通知
   */
  async save(context: FileSaveContext): Promise<boolean> {
    const fileStore = useFileStore();
    const notificationStore = useNotificationStore();
    const { session, reason } = context;

    // 检查是否需要跳过保存
    if (!fileStore.isDirty && reason !== 'manual') {
      // 文件未修改且不是手动保存，跳过
      return true;
    }

    const editor = getMarkdownDocumentEditorRuntimePort().getReadyEditor();
    if (!editor) {
      console.error('[MarkdownHandler] Editor instance not available');
      notificationStore.show(
        resolveCurrentWorkspaceMessage('workspace.fileManager.markdown.editorUnavailable'),
        'error',
        3000,
      );
      return false;
    }

    if (!session.documentId) {
      console.error('[MarkdownHandler] No document ID in session');
      notificationStore.show(
        resolveCurrentWorkspaceMessage('workspace.fileManager.markdown.documentIdMissing'),
        'error',
        3000,
      );
      return false;
    }

    fileStore.setSaving(true);
    try {
      const serializedContent = serializeRevisionBaselineForSave(editor);

      console.log(`[MarkdownHandler] Saving markdown document: ${session.documentId} (reason: ${reason})`);

      const result = await workspaceGateway['save-document']({
        documentId: session.documentId,
        content: serializedContent,
      });

      if (result.success) {
        fileStore.setDirty(false);

        // 根据保存原因决定是否显示通知
        if (reason === 'manual') {
          notificationStore.show(
            resolveCurrentWorkspaceMessage('workspace.fileManager.markdown.saved'),
            'success',
            1500,
          );
        }
        return true;
      } else {
        const errorMsg = ('error' in result && result.error)
          ? result.error
          : resolveCurrentWorkspaceMessage('workspace.fileManager.save.unknownError');
        console.error(`[MarkdownHandler] Save failed (${reason}):`, errorMsg);
        notificationStore.show(
          resolveCurrentWorkspaceMessage('workspace.fileManager.save.failed'),
          'error',
          3500,
        );
        return false;
      }
    } catch (error) {
      console.error(`[MarkdownHandler] IPC save failed (${reason}):`, error);
      notificationStore.show(
        resolveCurrentWorkspaceMessage('workspace.fileManager.save.exception'),
        'error',
        3500,
      );
      return false;
    } finally {
      fileStore.setSaving(false);
    }
  },

  /**
   * 关闭 Markdown 文档（清理逻辑）
   */
  async close(session: FileSessionDescriptor): Promise<void> {
    console.log(`[MarkdownHandler] Closing markdown document: ${session.documentId}`);
    // 如果需要做清理，可以在这里添加
  },
};
