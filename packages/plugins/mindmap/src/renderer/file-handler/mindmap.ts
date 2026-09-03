/**
 * @file MindMap 文件类型的 lifecycle handler
 * 
 * @description
 * 此模块实现 MindMap 文档的打开和保存逻辑。
 * 
 * 职责:
 * - 从后端加载 MindMap 数据
 * - 将数据挂载到 MindMap Engine
 * - 序列化并保存 MindMap 数据到后端
 * - 处理 MindMapStore 的 dirty 状态
 * 
 * 设计说明:
 * - MindMap Engine 会管理自己的状态（节点树、视口等）
 * - 保存时需要从 Engine 导出完整的数据结构和元数据
 * - MindMapStore 用于在 Engine 和 file-manager 之间协调
 */

import {
  isFileSessionOpenCancelledError,
  isActiveFileDirty,
  notifyWorkspaceDocumentOpened,
  setActiveFileDirty,
  setActiveFileLoading,
  setActiveFileSaving,
  showWorkspaceNotification,
  throwIfFileSessionOpenCancelled,
  type FileTypeLifecycleHandler,
  type FileSessionDescriptor,
  type FileSaveContext,
} from '@plugin/renderer/workspaceRuntime';
import { MINDMAP_FILE_SESSION_TYPE } from '@plugin/mindmap/shared';
import { mindMapGateway } from '../ipc/mindMapGateway';
import { getMindMapAdapter } from './mindmapAdapterBridge';

/**
 * MindMap 文件 Handler 实现
 */
export const mindmapHandler: FileTypeLifecycleHandler = {
  type: MINDMAP_FILE_SESSION_TYPE,

  /**
   * 打开 MindMap 文档
   * 
   * 流程:
   * 1. 调用 mindMapGateway 从后端加载 MindMap 数据
   * 2. 将数据传递给 MindMap Engine（通过组件通信）
   * 3. Engine 挂载并渲染节点树
   */
  async open(session: FileSessionDescriptor): Promise<void> {
    const mindMapAdapter = getMindMapAdapter();

    try {
      setActiveFileLoading(true);

      const documentId = session.documentId;
      console.log(`[MindMapHandler] Opening mindmap document: ${documentId}`);

      // 中文说明：handler 不再切换视图；当前文档上下文只作为编辑能力的运行期输入。

      // 从后端加载 MindMap 数据
      const result = await mindMapGateway.read({ documentId });

      if (!result.success) {
        throw new Error(result.error || 'Failed to load mindmap data');
      }

      if (!result.data) {
        throw new Error('MindMap data is empty');
      }

      throwIfFileSessionOpenCancelled(session);
      mindMapAdapter.setDocumentSession({
        documentId,
        name: session.displayName ?? '未命名思维导图',
        content: result.data.content,
        metadata: result.data.metadata,
      });

      await notifyWorkspaceDocumentOpened({ documentId });
      throwIfFileSessionOpenCancelled(session);
      setActiveFileDirty(false);
      console.log(`[MindMapHandler] Mindmap document loaded successfully: ${documentId}`);
    } catch (error) {
      if (isFileSessionOpenCancelledError(error)) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[MindMapHandler] Failed to open mindmap document:', error);
      showWorkspaceNotification(`打开思维导图失败: ${errorMessage}`, 'error', 3000);
      throw error;
    } finally {
      setActiveFileLoading(false);
    }
  },

  /**
   * 保存 MindMap 文档
   * 
   * 流程:
   * 1. 获取 MindMap Engine 并导出完整数据
   * 2. 提取元数据（主题、布局、视口等）
   * 3. 通过 mindMapGateway 保存到后端
   * 4. 更新 dirty 状态和显示通知
   */
  async save(context: FileSaveContext): Promise<boolean> {
    const mindMapAdapter = getMindMapAdapter();
    const { session, reason } = context;
    const isDirty = isActiveFileDirty();

    console.log('[MindMapHandler] save 调用', {
      documentId: session.documentId,
      reason,
      isDirty,
    });

    // 检查是否需要跳过保存
    if (!isDirty && reason !== 'manual') {
      console.log('[MindMapHandler] 未修改且非手动保存，跳过');
      return true;
    }

    const documentId = session.documentId;
    if (!documentId) {
      console.error('[MindMapHandler] No document ID in session');
      showWorkspaceNotification('保存失败：文档ID丢失', 'error', 3000);
      return false;
    }

    setActiveFileSaving(true);
    try {
      const snapshot = mindMapAdapter.getSerializableState();
      if (!snapshot) {
        console.error('[MindMapHandler] 无法导出思维导图数据：MindMap 尚未就绪');
        showWorkspaceNotification('保存失败：思维导图尚未加载完成', 'error', 3000);
        return false;
      }

      const result = await mindMapGateway.update({
        documentId,
        content: snapshot.content,
        metadata: snapshot.metadata,
      });

      if (result.success) {
        setActiveFileDirty(false);

        // 根据保存原因决定是否显示通知
        if (reason === 'manual') {
          showWorkspaceNotification('思维导图已保存', 'success', 1500);
        }
        return true;
      } else {
        const errorMsg = result.error || '未知错误';
        console.error(`[MindMapHandler] Save failed (${reason}):`, errorMsg);
        showWorkspaceNotification(`保存失败: ${errorMsg}`, 'error', 3500);
        return false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[MindMapHandler] Save error (${reason}):`, error);
      showWorkspaceNotification(`保存出错 (${reason}): ${errorMessage}`, 'error', 3500);
      return false;
    } finally {
      setActiveFileSaving(false);
    }
  },

  /**
   * 关闭 MindMap 文档（清理逻辑）
   */
  async close(session: FileSessionDescriptor): Promise<void> {
    console.log(`[MindMapHandler] Closing mindmap document: ${session.documentId}`);
    getMindMapAdapter().closeDocumentSession(session.documentId);
  },
};
