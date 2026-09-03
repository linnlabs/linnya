import { shallowRef } from 'vue'
import type { Component } from 'vue'
import type { MindMapInstance } from '../../domain/types'

/**
 * Node Addons Registry（节点 addons 注册表）
 *
 * 中文说明：
 * - 这是“白板方向”的关键基础设施：节点下可以挂载任意 addon（引用/图片/卡片/预览等）
 * - UI 渲染由统一的 Host 负责，feature 只需要 register/unregister，不需要自己 Teleport/查 DOM
 * - 使用 WeakMap 以 MindMapInstance 作为 key，避免跨文档状态串扰且自然释放
 */

export interface NodeAddonRenderContext {
  mind: MindMapInstance
  nodeId: string
}

export interface NodeAddonRegistration {
  /** addon 唯一 id（建议：featureName:addonName） */
  id: string
  /** 渲染顺序（数值越小越靠前） */
  order: number
  /** 渲染组件（必须接受 props: { mind, nodeId }） */
  component: Component
  /**
   * 依赖追踪（可选）
   *
   * 中文说明（根因修复）：
   * - NodeAddonsHost 的 `renderItems` 计算依赖于：
   *   - DOM 中是否存在 `.mm-topic-addons`
   *   - `shouldRender(ctx)` 的返回值
   * - 但有些 feature 的“渲染条件”来自 Pinia store（例如引用 count），而 store 变更并不一定能稳定触发
   *   `renderItems` 的重新计算（尤其是当渲染条件在闭包函数中读取、且 store 使用对象整体替换时）。
   * - `track()` 允许 feature 明确声明“哪些响应式数据会影响渲染条件”，Host 会在计算时调用它，
   *   从而建立稳定的响应式依赖链，避免“count 已加载但 UI 不出现”的不确定性。
   *
   * 约束：
   * - 必须是无副作用的读取（纯依赖声明），禁止写入 store / 操作 DOM。
   */
  track?: () => void
  /**
   * 是否应该渲染
   *
   * 中文说明：
   * - 应当是纯函数：只依赖响应式 store / ctx 输入，不做副作用
   * - 用于避免无意义的 Teleport 与 DOM 占位
   */
  shouldRender: (ctx: NodeAddonRenderContext) => boolean
}

export interface NodeAddonsRegistry {
  registrations: ReturnType<typeof shallowRef<NodeAddonRegistration[]>>
  register: (registration: NodeAddonRegistration) => () => void
}

const REGISTRY_MAP = new WeakMap<MindMapInstance, NodeAddonsRegistry>()

export function getNodeAddonsRegistry(mind: MindMapInstance): NodeAddonsRegistry {
  const existing = REGISTRY_MAP.get(mind)
  if (existing) return existing

  const registrations = shallowRef<NodeAddonRegistration[]>([])

  const registry: NodeAddonsRegistry = {
    registrations,
    register: (registration) => {
      registrations.value = [...registrations.value, registration].sort((a, b) => a.order - b.order)
      return () => {
        registrations.value = registrations.value.filter(r => r.id !== registration.id)
      }
    },
  }

  REGISTRY_MAP.set(mind, registry)
  return registry
}

