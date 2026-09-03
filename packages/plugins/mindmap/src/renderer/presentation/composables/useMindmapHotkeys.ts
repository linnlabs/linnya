import { onMounted, onUnmounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type { MindMapInstance } from '../../domain/types'
import { useMindMapStore } from '../../domain/store/mindmapStore'
import {
  installAndExtend,
  type KeymapItem,
} from '../../interaction/keyboard'

/**
 * 检查是否是可编辑元素
 *
 * 中文说明：
 * - 用于判断焦点状态
 * - 支持原生表单元素、contentEditable、自定义标记
 */
const isEditableElement = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false
  const tagName = el.tagName.toLowerCase()
  if (['input', 'textarea', 'select'].includes(tagName)) return true
  if (el.isContentEditable) return true
  return Boolean(el.closest('[data-mindmap-editable="true"]'))
}

/**
 * MindMap 快捷键 composable（Phase 2 重构版）
 *
 * 中文说明：
 * - 使用 KeymapRegistry 替代原有的 key -> function 映射
 * - 保持 hotkeyConfig 的覆盖功能（向后兼容）
 * - 保持 isEditingInput 的焦点状态管理
 *
 * 改动说明：
 * - 原实现：createDefaultHotkeyMap + resolveHandler + 手动 keydown 监听
 * - 新实现：installMindMapKeymap（内部集成 KeymapRegistry + IntentDispatcher）
 */
export function useMindmapHotkeys() {
  const store = useMindMapStore()
  const { mind, hotkeyConfig } = storeToRefs(store)

  // 清理函数（包含 keymap 与扩展字段清理）
  let disposeKeymap: (() => void) | null = null
  // 焦点事件清理函数
  let focusCleanup: (() => void) | null = null

  /**
   * 将 hotkeyConfig 转换为 KeymapRegistry 的 overrides 格式
   *
   * 中文说明：
   * - hotkeyConfig 是基于 event.key 的旧格式
   * - 需要映射到 KeymapItem 的 id
   * - 保持向后兼容
   */
  const convertHotkeyConfigToOverrides = (): Record<string, false | Partial<KeymapItem>> => {
    const overrides: Record<string, false | Partial<KeymapItem>> = {}
    const config = hotkeyConfig.value

    // 映射表：event.key -> KeymapItem.id
    // 中文说明：由于历史原因，hotkeyConfig 使用 event.key 作为键名
    const keyToIdMap: Record<string, string | string[]> = {
      Enter: ['node.insertSiblingAfter', 'node.insertSiblingBefore', 'node.insertParent'],
      Tab: 'node.addChild',
      Delete: 'node.remove.delete',
      Backspace: 'node.remove.backspace',
      ' ': 'edit.space',
      Spacebar: 'edit.space',
      F2: 'edit.f2',
      ArrowUp: ['navigate.up', 'node.moveUp'],
      ArrowDown: ['navigate.down', 'node.moveDown'],
      ArrowLeft: 'navigate.left',
      ArrowRight: 'navigate.right',
      F1: 'view.toCenter',
      '=': 'view.zoomIn',
      '-': 'view.zoomOut',
      '0': 'view.resetZoom',
      c: 'clipboard.copy',
      x: 'clipboard.cut',
      v: 'clipboard.paste',
    }

    for (const [key, override] of Object.entries(config)) {
      const ids = keyToIdMap[key]
      if (!ids) continue

      const idList = Array.isArray(ids) ? ids : [ids]

      for (const id of idList) {
        if (override.enabled === false) {
          overrides[id] = false
        } else if (override.handler) {
          // 自定义 handler：转换为 KeymapItem 的 run
          overrides[id] = {
            run: (_ctx, event) => {
              override.handler!(event)
              return true
            },
          }
        }
      }
    }

    return overrides
  }

  /**
   * 绑定事件到 MindMap 实例
   */
  const bindEvents = (instance: MindMapInstance) => {
    const container = instance.container
    if (!container) return

    // 安装键盘系统
    const overrides = convertHotkeyConfigToOverrides()
    disposeKeymap = installAndExtend(instance, {
      registerDefaultKeymap: true,
      overrides,
      debug: import.meta.env.DEV,
    })

    // 焦点状态管理（保持原有逻辑）
    const handleFocusIn = (e: FocusEvent) => {
      store.setIsEditingInput(isEditableElement(e.target))
    }

    const handleFocusOut = (e: FocusEvent) => {
      store.setIsEditingInput(isEditableElement(e.relatedTarget))
    }

    container.addEventListener('focusin', handleFocusIn)
    container.addEventListener('focusout', handleFocusOut)

    focusCleanup = () => {
      container.removeEventListener('focusin', handleFocusIn)
      container.removeEventListener('focusout', handleFocusOut)
      store.setIsEditingInput(false)
    }
  }

  /**
   * 解绑事件
   */
  const unbind = () => {
    disposeKeymap?.()
    disposeKeymap = null
    focusCleanup?.()
    focusCleanup = null
  }

  // 生命周期管理
  onMounted(() => {
    if (mind.value) {
      bindEvents(mind.value)
    }
  })

  watch(
    () => mind.value,
    (instance, prevInstance) => {
      if (prevInstance) {
        unbind()
      }
      if (instance) {
        bindEvents(instance)
      }
    }
  )

  // hotkeyConfig 变化时重新绑定
  watch(
    () => hotkeyConfig.value,
    () => {
      if (mind.value) {
        unbind()
        bindEvents(mind.value)
      }
    },
    { deep: true }
  )

  onUnmounted(() => {
    unbind()
  })

  // 返回 registry 和 dispatcher 供外部使用（可选）
  return {
    getRegistry: () => (mind.value as unknown as { keymapRegistry?: unknown } | null)?.keymapRegistry ?? null,
    getDispatcher: () => (mind.value as unknown as { intentDispatcher?: unknown } | null)?.intentDispatcher ?? null,
  }
}
