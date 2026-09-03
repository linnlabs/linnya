/**
 * @file 自动刷新 Feature 安装入口
 *
 * 中文说明：
 * - 在 MindMapView 挂载时安装
 * - 监听文档切换，清理状态
 * - 返回清理函数
 *
 * @see packages/plugins/mindmap/src/renderer/features/autoRefresh/README.md
 */

import type { MindMapInstance } from '../../../domain/types'
import { installFeatureLifecycle } from '../../shared/installFeatureLifecycle'
import { cancelAllPendingRefresh, setAutoRefreshDebug } from './mindMapAutoRefreshService'
import { LOG_PREFIX } from '../domain/types'

/**
 * 安装自动刷新 Feature
 *
 * 中文说明：
 * - 使用 installFeatureLifecycle 统一管理生命周期
 * - 在 documentReady 时清理旧状态（文档切换场景）
 *
 * @param mind MindMapInstance 实例
 * @returns 清理函数
 */
export function installMindMapAutoRefreshFeature(mind: MindMapInstance): () => void {
  console.log(`${LOG_PREFIX} feature installing...`)

  const dispose = installFeatureLifecycle(mind, {
    featureName: 'AutoRefresh',

    /**
     * 文档就绪时回调
     *
     * 中文说明：
     * - 新文档加载时，清理之前文档的待处理刷新
     * - 避免刷新执行到错误的文档
     */
    onDocumentReady: (_ctx, payload) => {
      if (payload.reason === 'switch') {
        // 文档切换：清理旧文档的 pending
        console.log(`${LOG_PREFIX} document switched, cancelling old pending`)
        cancelAllPendingRefresh()
      }
    },

    /**
     * 结构就绪时回调
     *
     * 中文说明：
     * - 结构重建完成，此时可以安全地访问 nodeData
     * - 自动刷新 feature 不需要在这里做额外操作
     */
    onStructureReady: () => {
      // 不需要额外操作
    },
  })

  console.log(`${LOG_PREFIX} feature installed`)

  return () => {
    console.log(`${LOG_PREFIX} feature disposing...`)
    cancelAllPendingRefresh()
    dispose()
  }
}

// 导出调试函数供外部使用
export { setAutoRefreshDebug }
