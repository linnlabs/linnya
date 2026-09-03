/**
 * 编辑器服务启动器
 * 集中管理编辑器的所有副作用启动和清理
 */
import type { Editor } from '@tiptap/vue-3'

// 扩展 Window 接口以包含自定义属性
declare global {
  interface Window {
    __APP_NOTIFICATION_STORE__?: any
  }
}

export interface EditorStores {
  fileStore: any
  uiStore: any
  notificationStore: any
  annotationStore: any
}

export interface BootstrapOptions {
  editor: Editor
  stores: EditorStores
}

/**
 * 启动所有编辑器服务
 * @param options - 包含编辑器实例和所需 stores 的配置对象
 * @returns 清理函数，用于停止所有服务
 */
export function bootstrapEditorServices(options: BootstrapOptions): () => void {
  const { editor, stores } = options
  const disposers: Array<() => void> = []

  // 1. 注册全局对象（保持幂等）
  const unregisterGlobals = registerGlobalObjects({ 
    notificationStore: stores.notificationStore 
  })
  disposers.push(unregisterGlobals)

  // 2. 可以在这里添加更多服务的启动逻辑
  // 例如：表格 AI 集成、事件总线监听等

  // 返回统一的清理函数
  return () => {
    // 按相反顺序清理
    disposers.reverse().forEach(dispose => {
      try {
        dispose()
      } catch (error) {
        console.error('[BootstrapServices] 清理服务时出错:', error)
      }
    })
  }
}

/**
 * 注册全局对象到 window
 * @param options - 包含要注册的对象
 * @returns 清理函数
 */
function registerGlobalObjects(options: { notificationStore: any }): () => void {
  const { notificationStore } = options

  // 注册通知存储
  if (notificationStore && !window.__APP_NOTIFICATION_STORE__) {
    window.__APP_NOTIFICATION_STORE__ = notificationStore
  }

  // 返回清理函数
  return () => {
    // 可选：清理全局对象
    // delete window.__APP_NOTIFICATION_STORE__
    // 注意：通常我们不需要清理，因为应用通常不会频繁创建/销毁编辑器
  }
}

