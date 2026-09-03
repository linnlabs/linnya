import type { Editor } from '@tiptap/core'
import { BlockAction } from '../../../shared/utils/blockEventUtils'
import { useRevisionStore } from '../store/useRevisionStore'

/**
 * block-operation 事件的载荷类型定义
 * - 与 blockEventUtils.emitBlockOperation 发出的结构保持一致
 */
interface BlockOperationDetail {
  action: string
  blockIds: string[]
  // 这里不关心 payload 的具体结构，只做透传与日志使用
  payload?: unknown
  timestamp?: number
}

/**
 * 简单的事件总线接口定义
 * - EditorFactory 中为 editor.eventBus 挂载了 on/off/emit 方法
 */
interface BlockEventBus {
  on(event: string, callback: (detail: BlockOperationDetail) => void): void
  off(event: string, callback: (detail: BlockOperationDetail) => void): void
}

/**
 * 扩展后的 Editor 类型，包含事件总线接口
 */
interface EditorWithEventBus extends Editor {
  eventBus?: BlockEventBus
}

/**
 * 为 Revision 挂载块级生命周期监听器
 *
 * 职责：
 * - 监听统一的 'block-operation' 事件流
 * - 在块被删除 (BlockAction.DELETE) 时：
 *   - 清理 RevisionStore 中对应块的前端状态
 *   - 调用 RevisionStore 的后端清理方法，删除 markdown_block_pending_revisions 中的幽灵记录
 *
 * 设计原则：
 * - 不直接操作 ProseMirror 文档结构，仅关注「块已删除」这一事实
 * - 通过 RevisionStore 暴露的 API 完成前后端的一致性维护
 */
export function setupRevisionBlockEventHandler(editor: EditorWithEventBus) {
  const eventBus = editor.eventBus

  if (!eventBus || typeof eventBus.on !== 'function' || typeof eventBus.off !== 'function') {
    console.error('[RevisionBlockEventHandler] 设置失败：editor.eventBus 无效。')
    return null
  }

  // 通过单例工厂获取当前 Editor 对应的 RevisionStore
  const revisionStore = useRevisionStore(editor)

  const handleBlockOperation = async (detail: BlockOperationDetail) => {
    if (!detail || !detail.action || !detail.blockIds) {
      console.warn('[RevisionBlockEventHandler] 收到无效的 block-operation 事件:', detail)
      return
    }

    const { action, blockIds } = detail

    if (action !== BlockAction.DELETE) {
      // Revision 目前只关心删除事件，其他操作由各自模块处理
      return
    }

    if (!Array.isArray(blockIds) || blockIds.length === 0) {
      return
    }

    for (const blockId of blockIds) {
      try {
        // 1. 清理前端 RevisionStore 状态
        revisionStore.clearRevision(blockId)

        // 2. 清理后端该块的 pending revision 记录（如果存在）
        await revisionStore.clearBackendPendingForBlock(blockId)
      } catch (error) {
        console.error(
          `[RevisionBlockEventHandler] 清理块 ${blockId} 修订状态时出错:`,
          error,
        )
      }
    }
  }

  eventBus.on('block-operation', handleBlockOperation)

  // 返回清理函数，供未来在 editor 销毁时解绑监听
  return () => {
    eventBus.off('block-operation', handleBlockOperation)
  }
}


