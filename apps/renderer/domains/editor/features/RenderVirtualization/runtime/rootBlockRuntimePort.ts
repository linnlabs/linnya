import type { RenderVirtualizationOwner } from '../definitions/renderVirtualizationOwner'
import {
  getRootBlockRuntimeRegistry,
  type RootBlockRuntimeHandle,
  type RootBlockRuntimeRegistryOwner,
} from './RootBlockRuntimeRegistry'

export type {
  RootBlockRuntimeHandle,
  RootBlockRuntimeRegistryOwner,
}

export interface RootBlockRuntimeSubscriptionOptions {
  replayExisting?: boolean
}

/**
 * 读取当前 editor owner 下已经 hydrated 的 rootBlock 运行时句柄。
 *
 * 中文说明：业务层只需要 action-time 查询 hydrated handle，不应该拿到 registry 的
 * register / reset 等写能力。内部 NodeView 注册仍走 RootBlockRuntimeRegistry。
 */
export function getHydratedRootBlockRuntimeHandle(
  blockId: string,
  owner: RenderVirtualizationOwner
): RootBlockRuntimeHandle | null {
  return getRootBlockRuntimeRegistry(owner).getHydrated(blockId)
}

/**
 * 订阅 rootBlock runtime handle 变化，只暴露“需要重新采样”的信号。
 *
 * 中文说明：Host 只需要知道 runtime target 可能变化，不应该依赖 registry event
 * 的完整结构做业务分支；这样后续 per-editor registry 重构时 public 契约更稳定。
 */
export function subscribeRootBlockRuntimeHandles(
  owner: RootBlockRuntimeRegistryOwner,
  listener: () => void,
  options: RootBlockRuntimeSubscriptionOptions = {}
): () => void {
  return getRootBlockRuntimeRegistry(owner).subscribe(() => {
    listener()
  }, options)
}
