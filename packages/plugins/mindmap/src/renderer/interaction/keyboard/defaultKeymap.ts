/**
 * MindMap 默认键盘映射
 *
 * 中文说明：
 * - 从 shared/hotkeys/defaultHotkeys.ts 迁移而来
 * - 使用 KeymapRegistry 的结构化注册方式
 * - 通过 Intent 系统统一调用 commands
 *
 * 迁移策略：
 * - 已走 commands 的快捷键（Enter/Tab/Delete）：通过 Intent 调用
 * - 未命令化的快捷键（导航/缩放）：暂时保留直接调用，标记 TODO
 *
 * @module interaction/keyboard/defaultKeymap
 */

import type { KeymapItem, KeymapContext, KeymapRun } from './KeymapRegistry'
import { whenNotEditing, whenHasSelection, whenHasAnySelection, whenAll } from './KeymapRegistry'
import type { IntentDispatcher } from '../intents/intentDispatcher'
import { createIntent } from '../intents/types'
import { handleLeftRight, handleVerticalNavigation } from './navigation'
import { setExpand } from '../../shared/utils/tree/index'

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 获取当前节点 ID
 */
function getCurrentNodeId(ctx: KeymapContext): string | null {
  return ctx.mind.currentNode?.nodeObj?.id ?? null
}

/**
 * 创建 Intent 派发的 run 函数
 */
function dispatchIntent(
  dispatcher: IntentDispatcher,
  intentName: Parameters<typeof createIntent>[0],
  getPayload: (ctx: KeymapContext) => Parameters<typeof createIntent>[1]
): KeymapRun {
  return ctx => {
    const payload = getPayload(ctx)
    const intent = createIntent(intentName, payload, 'keyboard')
    const result = dispatcher.dispatch(intent)
    return result.handled
  }
}

// ============================================================================
// 默认快捷键定义
// ============================================================================

/**
 * 创建默认快捷键列表
 *
 * 中文说明：
 * - dispatcher 用于派发 Intent
 * - 返回 KeymapItem 数组，由 installMindMapKeymap 注册
 *
 * @param dispatcher IntentDispatcher 实例
 */
export function createDefaultKeymap(dispatcher: IntentDispatcher): KeymapItem[] {
  const items: KeymapItem[] = []

  // =========================================================================
  // 节点创建（已命令化）
  // =========================================================================

  // Enter: 在后插入兄弟节点
  items.push({
    id: 'node.insertSiblingAfter',
    binding: 'Enter',
    description: '在当前节点后插入兄弟节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: dispatchIntent(dispatcher, 'node:insertSiblingAfter', ctx => ({
      nodeId: getCurrentNodeId(ctx)!,
      edit: false,
    })),
  })

  // Shift+Enter: 在前插入兄弟节点
  items.push({
    id: 'node.insertSiblingBefore',
    binding: 'Shift+Enter',
    description: '在当前节点前插入兄弟节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: dispatchIntent(dispatcher, 'node:insertSiblingBefore', ctx => ({
      nodeId: getCurrentNodeId(ctx)!,
      edit: false,
    })),
  })

  // Mod+Enter: 插入父节点
  items.push({
    id: 'node.insertParent',
    binding: 'Mod+Enter',
    description: '为当前节点插入父节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: dispatchIntent(dispatcher, 'node:insertParent', ctx => ({
      nodeId: getCurrentNodeId(ctx)!,
      edit: false,
    })),
  })

  // Tab: 添加子节点
  items.push({
    id: 'node.addChild',
    binding: 'Tab',
    description: '为当前节点添加子节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: dispatchIntent(dispatcher, 'node:addChild', ctx => ({
      nodeId: getCurrentNodeId(ctx)!,
      edit: false,
    })),
  })

  // =========================================================================
  // 节点删除（已命令化）
  // =========================================================================

  // Delete/Backspace: 删除
  items.push({
    id: 'node.remove.delete',
    binding: 'Delete',
    description: '删除当前选中的节点/arrow/summary',
    when: whenAll(whenNotEditing, whenHasAnySelection),
    run: ctx => {
      const { mind } = ctx
      // 优先检测 arrow/summary
      if (mind.currentArrow) {
        const intent = createIntent('arrow:remove', {}, 'keyboard')
        dispatcher.dispatch(intent)
        return true
      }
      if (mind.currentSummary) {
        const intent = createIntent('summary:remove', {}, 'keyboard')
        dispatcher.dispatch(intent)
        return true
      }
      // 删除节点
      const intent = createIntent('node:remove', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  items.push({
    id: 'node.remove.backspace',
    binding: 'Backspace',
    description: '删除当前选中的节点/arrow/summary',
    when: whenAll(whenNotEditing, whenHasAnySelection),
    run: ctx => {
      const { mind } = ctx
      if (mind.currentArrow) {
        const intent = createIntent('arrow:remove', {}, 'keyboard')
        dispatcher.dispatch(intent)
        return true
      }
      if (mind.currentSummary) {
        const intent = createIntent('summary:remove', {}, 'keyboard')
        dispatcher.dispatch(intent)
        return true
      }
      const intent = createIntent('node:remove', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  // =========================================================================
  // 编辑
  // =========================================================================

  // Space: 开始编辑
  items.push({
    id: 'edit.space',
    binding: 'Space',
    description: '开始编辑当前节点/arrow/summary',
    when: whenAll(whenNotEditing, whenHasAnySelection),
    priority: 10, // 高优先级，避免被空格拖拽影响
    run: ctx => {
      const { mind } = ctx
      // 清除空格拖拽状态
      mind.spacePressed = false
      mind.container.classList.remove('space-pressed')

      if (mind.currentSummary) {
        const intent = createIntent(
          'summary:edit',
          { summaryId: mind.currentSummary.summaryObj.id },
          'keyboard'
        )
        dispatcher.dispatch(intent)
        return true
      }
      if (mind.currentArrow) {
        const intent = createIntent('arrow:edit', { arrowId: mind.currentArrow.id }, 'keyboard')
        dispatcher.dispatch(intent)
        return true
      }
      const nodeId = getCurrentNodeId(ctx)
      if (nodeId) {
        const intent = createIntent('ui:beginEdit', { nodeId }, 'keyboard')
        dispatcher.dispatch(intent)
        return true
      }
      return false
    },
  })

  // F2: 开始编辑（同 Space）
  items.push({
    id: 'edit.f2',
    binding: 'F2',
    description: '开始编辑当前节点/arrow/summary',
    when: whenAll(whenNotEditing, whenHasAnySelection),
    run: ctx => {
      const { mind } = ctx
      if (mind.currentSummary) {
        const intent = createIntent(
          'summary:edit',
          { summaryId: mind.currentSummary.summaryObj.id },
          'keyboard'
        )
        dispatcher.dispatch(intent)
        return true
      }
      if (mind.currentArrow) {
        const intent = createIntent('arrow:edit', { arrowId: mind.currentArrow.id }, 'keyboard')
        dispatcher.dispatch(intent)
        return true
      }
      const nodeId = getCurrentNodeId(ctx)
      if (nodeId) {
        const intent = createIntent('ui:beginEdit', { nodeId }, 'keyboard')
        dispatcher.dispatch(intent)
        return true
      }
      return false
    },
  })

  // =========================================================================
  // 导航（暂未命令化，直接调用 mind 方法）
  // =========================================================================

  // ArrowUp: 向上导航 / Alt+ArrowUp: 向上移动
  items.push({
    id: 'navigate.up',
    binding: 'ArrowUp',
    description: '向上导航到相邻节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      // TODO: 迁移到 Intent（node:navigate）
      handleVerticalNavigation(ctx.mind, 'up')
      return true
    },
  })

  items.push({
    id: 'node.moveUp',
    binding: 'Alt+ArrowUp',
    description: '向上移动当前节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      const intent = createIntent('node:moveUp', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  // Mod+ArrowUp: 初始化 Side
  items.push({
    id: 'view.initSide',
    binding: 'Mod+ArrowUp',
    description: '初始化 Side 方向',
    when: whenNotEditing,
    run: ctx => {
      ctx.mind.initSide()
      return true
    },
  })

  // ArrowDown: 向下导航 / Alt+ArrowDown: 向下移动
  items.push({
    id: 'navigate.down',
    binding: 'ArrowDown',
    description: '向下导航到相邻节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      handleVerticalNavigation(ctx.mind, 'down')
      return true
    },
  })

  items.push({
    id: 'node.moveDown',
    binding: 'Alt+ArrowDown',
    description: '向下移动当前节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      const intent = createIntent('node:moveDown', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  // ArrowLeft/Right: 左右导航
  items.push({
    id: 'navigate.left',
    binding: 'ArrowLeft',
    description: '向左导航',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      handleLeftRight(ctx.mind, 'lhs')
      return true
    },
  })

  items.push({
    id: 'navigate.right',
    binding: 'ArrowRight',
    description: '向右导航',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      handleLeftRight(ctx.mind, 'rhs')
      return true
    },
  })

  // Mod+ArrowLeft/Right: 初始化方向
  items.push({
    id: 'view.initLeft',
    binding: 'Mod+ArrowLeft',
    description: '初始化为左侧布局',
    when: whenNotEditing,
    run: ctx => {
      ctx.mind.initLeft()
      return true
    },
  })

  items.push({
    id: 'view.initRight',
    binding: 'Mod+ArrowRight',
    description: '初始化为右侧布局',
    when: whenNotEditing,
    run: ctx => {
      ctx.mind.initRight()
      return true
    },
  })

  // PageUp/PageDown: 移动节点
  items.push({
    id: 'node.moveUp.pageUp',
    binding: 'PageUp',
    description: '向上移动当前节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      const intent = createIntent('node:moveUp', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  items.push({
    id: 'node.moveDown.pageDown',
    binding: 'PageDown',
    description: '向下移动当前节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      const intent = createIntent('node:moveDown', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  // =========================================================================
  // 视图控制
  // =========================================================================

  // F1: 居中
  items.push({
    id: 'view.toCenter',
    binding: 'F1',
    description: '将视图居中到根节点',
    when: whenNotEditing,
    run: ctx => {
      const intent = createIntent('canvas:toCenter', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  // Mod+=: 放大
  items.push({
    id: 'view.zoomIn',
    binding: 'Mod+=',
    description: '放大视图',
    when: whenNotEditing,
    run: ctx => {
      const intent = createIntent('canvas:zoomIn', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  // Mod+-: 缩小
  items.push({
    id: 'view.zoomOut',
    binding: 'Mod+-',
    description: '缩小视图',
    when: whenNotEditing,
    run: ctx => {
      const intent = createIntent('canvas:zoomOut', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  // Mod+0: 重置缩放（不在 Ctrl+K 序列中）
  items.push({
    id: 'view.resetZoom',
    binding: 'Mod+0',
    description: '重置缩放到 100%',
    when: whenNotEditing,
    priority: -10, // 低优先级，让 Mod+K Mod+0 优先
    run: ctx => {
      const intent = createIntent('canvas:resetZoom', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  // =========================================================================
  // 复制/剪切/粘贴（暂未命令化）
  // =========================================================================

  items.push({
    id: 'clipboard.copy',
    binding: 'Mod+C',
    description: '复制当前选中的节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      ctx.mind.waitCopy = ctx.mind.currentNodes
      return true
    },
  })

  items.push({
    id: 'clipboard.cut',
    binding: 'Mod+X',
    description: '剪切当前选中的节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      ctx.mind.waitCopy = ctx.mind.currentNodes
      // 删除节点
      const intent = createIntent('node:remove', {}, 'keyboard')
      dispatcher.dispatch(intent)
      return true
    },
  })

  items.push({
    id: 'clipboard.paste',
    binding: 'Mod+V',
    description: '粘贴节点',
    when: whenAll(whenNotEditing, whenHasSelection),
    run: ctx => {
      const { mind } = ctx
      if (!mind.waitCopy || !mind.currentNode) return false
      if (mind.waitCopy.length === 1) {
        mind.copyNode(mind.waitCopy[0], mind.currentNode)
      } else {
        mind.copyNodes(mind.waitCopy, mind.currentNode)
      }
      return true
    },
  })

  // =========================================================================
  // 历史操作（undo/redo）
  // 中文说明：从 operationHistory.ts 迁移而来
  // =========================================================================

  // Evidence Undo: 恢复软删除的证据（更高优先级）
  // 中文说明：从 evidenceSyncPlugin.ts 迁移而来
  items.push({
    id: 'evidence.undo',
    binding: 'Mod+Z',
    description: '恢复最近删除的证据（如果有）',
    when: whenNotEditing,
    priority: 5, // 高于 history.undo，先尝试恢复证据
    run: ctx => {
      // 检查是否有 evidence 恢复函数
      const restoreUndo = (ctx.mind as { _evidenceRestoreUndo?: () => Promise<boolean> })._evidenceRestoreUndo
      if (!restoreUndo) {
        // 没有安装 evidence 插件，继续执行下一个匹配（history.undo）
        return false
      }
      // 异步恢复，但不阻塞
      // 中文说明：V1 简化方案，恢复完成后由 history.undo 继续执行
      restoreUndo()
      // 返回 false 让 history.undo 也能执行
      return false
    },
  })

  // Mod+Z: 撤销
  items.push({
    id: 'history.undo',
    binding: 'Mod+Z',
    description: '撤销上一步操作',
    when: whenNotEditing,
    priority: -5, // 较低优先级，在 evidence.undo 之后执行
    run: ctx => {
      ctx.mind.undo()
      return true
    },
  })

  // Mod+Shift+Z: 重做
  items.push({
    id: 'history.redo.shiftZ',
    binding: 'Mod+Shift+Z',
    description: '重做已撤销的操作',
    when: whenNotEditing,
    run: ctx => {
      ctx.mind.redo()
      return true
    },
  })

  // Mod+Y: 重做（Windows 风格）
  items.push({
    id: 'history.redo.y',
    binding: 'Mod+Y',
    description: '重做已撤销的操作',
    when: whenNotEditing,
    run: ctx => {
      ctx.mind.redo()
      return true
    },
  })

  // =========================================================================
  // 展开层级（序列键）
  // =========================================================================

  // Mod+K Mod+0: 折叠所有
  items.push({
    id: 'expand.collapseAll',
    binding: 'Mod+K Mod+0',
    description: '折叠所有节点',
    when: whenNotEditing,
    priority: 10,
    run: ctx => {
      const { mind } = ctx
      mind.nodeData.children?.forEach(node => setExpand(node, false))
      mind.refresh()
      mind.toCenter()
      return true
    },
  })

  // Mod+K Mod+=: 展开所有
  items.push({
    id: 'expand.expandAll',
    binding: 'Mod+K Mod+=',
    description: '展开所有节点',
    when: whenNotEditing,
    priority: 10,
    run: ctx => {
      const { mind } = ctx
      mind.nodeData.children?.forEach(node => setExpand(node, true))
      mind.refresh()
      mind.toCenter()
      return true
    },
  })

  // Mod+K Mod+1~9: 展开到指定层级
  for (let level = 1; level <= 9; level++) {
    items.push({
      id: `expand.level${level}`,
      binding: `Mod+K Mod+${level}`,
      description: `展开到第 ${level} 层`,
      when: whenNotEditing,
      priority: 10,
      run: ctx => {
        const { mind } = ctx
        mind.nodeData.children?.forEach(node => setExpand(node, true, level - 1))
        mind.refresh()
        mind.toCenter()
        return true
      },
    })
  }

  return items
}
