/**
 * TableHeaderSyncPlugin - 表格坐标轴同步插件
 *
 * 职责：
 * 1. 监听文档变更，触发坐标轴重新计算
 * 2. 基于事务驱动，避免 DOM 测量的时序问题
 * 3. 会话隔离，避免竞态条件
 */

import { Plugin, PluginKey } from 'prosemirror-state'

export const TableHeaderSyncPluginKey = new PluginKey('tableHeaderSync')

/**
 * 创建表格坐标轴同步插件
 * @param {Object} options - 配置选项
 * @param {Function} options.onTableChanged - 表格变更回调
 * @returns {Plugin} ProseMirror 插件实例
 */
export function createTableHeaderSyncPlugin(options = {}) {
  const { onTableChanged } = options

  return new Plugin({
    key: TableHeaderSyncPluginKey,

    state: {
      init() {
        return {
          // 当前会话 ID（用于隔离）
          sessionId: 0,
          // 当前激活的表格位置
          activeTablePos: null,
          // 上次文档版本
          lastDocVersion: null
        }
      },

      apply(tr, pluginState, oldState, newState) {
        // 检查是否有会话 bump 请求
        const bumpSession = tr.getMeta(TableHeaderSyncPluginKey)?.bumpSession
        if (bumpSession) {
          console.log('[TableHeaderSyncPlugin] Session bumped:', pluginState.sessionId, '->', pluginState.sessionId + 1)
          return {
            ...pluginState,
            sessionId: pluginState.sessionId + 1,
            activeTablePos: null
          }
        }

        // 检查是否有激活表格的请求
        const setActiveTable = tr.getMeta(TableHeaderSyncPluginKey)?.setActiveTable
        if (setActiveTable !== undefined) {
          return {
            ...pluginState,
            activeTablePos: setActiveTable
          }
        }

        return pluginState
      }
    },

    view() {
      return {
        update(view, prevState) {
          const pluginState = TableHeaderSyncPluginKey.getState(view.state)
          if (!pluginState.activeTablePos) return

          const { activeTablePos, sessionId } = pluginState
          const { state } = view
          const tr = state.tr

          // 检查文档是否变更
          const docChanged = !prevState || prevState.doc !== state.doc

          // 检查选区是否与表格相关
          const selection = state.selection
          const selectionInTable =
            selection.$anchor.pos >= activeTablePos &&
            selection.$anchor.pos <= activeTablePos + state.doc.nodeAt(activeTablePos)?.nodeSize

          // 如果文档变更或选区在表格内，触发同步
          if (docChanged || selectionInTable) {
            // 获取表格节点
            const tableNode = state.doc.nodeAt(activeTablePos)
            if (tableNode && tableNode.type.name === 'table') {
              console.log('[TableHeaderSyncPlugin] Table changed detected, notifying headers')

              // 触发回调（如果提供）
              if (onTableChanged) {
                // 延迟到下一个微任务，确保 DOM 已更新
                Promise.resolve().then(() => {
                  onTableChanged({
                    sessionId,
                    tablePos: activeTablePos,
                    tableNode,
                    reason: docChanged ? 'doc-changed' : 'selection-changed'
                  })
                })
              }
            }
          }
        }
      }
    }
  })
}

/**
 * 工具函数：Bump 会话 ID
 */
export function bumpHeaderSession(view) {
  const tr = view.state.tr
  tr.setMeta(TableHeaderSyncPluginKey, { bumpSession: true })
  view.dispatch(tr)
}

/**
 * 工具函数：设置激活的表格
 */
export function setActiveTable(view, tablePos) {
  const tr = view.state.tr
  tr.setMeta(TableHeaderSyncPluginKey, { setActiveTable: tablePos })
  view.dispatch(tr)
}

/**
 * 工具函数：获取当前会话 ID
 */
export function getCurrentSessionId(state) {
  const pluginState = TableHeaderSyncPluginKey.getState(state)
  return pluginState?.sessionId ?? 0
}
