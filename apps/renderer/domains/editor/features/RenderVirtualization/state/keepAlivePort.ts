import type { InjectionKey } from 'vue'
import type {
  KeepAliveRegistry,
  RenderVirtualizationKeepAliveReason,
} from './keepAliveRegistry'
import { dispatchRenderVirtualizationKeepAlive } from './keepAliveEvents'

export interface RenderVirtualizationKeepAliveCommand {
  blockId: string
  reason: RenderVirtualizationKeepAliveReason
}

export interface RenderVirtualizationKeepAlivePort {
  acquire: (command: RenderVirtualizationKeepAliveCommand) => boolean
  release: (command: RenderVirtualizationKeepAliveCommand) => boolean
  releaseReason: (reason: RenderVirtualizationKeepAliveReason) => readonly string[]
  hasReason: (command: RenderVirtualizationKeepAliveCommand) => boolean
}

export interface ApplyRenderVirtualizationKeepAliveCommandInput {
  port?: RenderVirtualizationKeepAlivePort | null
  /**
   * 中文说明：target 只服务旧 DOM event adapter。新入口应该优先传 port，
   * 这样 Teleport / detached release / 跨 editor 场景都不依赖 DOM 冒泡。
   */
  legacyTarget?: EventTarget | null
  command: RenderVirtualizationKeepAliveCommand
  active: boolean
}

export const RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY:
  InjectionKey<RenderVirtualizationKeepAlivePort> =
    Symbol('RenderVirtualizationKeepAlivePort')

export function createRegistryKeepAlivePort(
  registry: Pick<KeepAliveRegistry, 'pin' | 'unpin' | 'unpinReason' | 'getReasons'>
): RenderVirtualizationKeepAlivePort {
  return {
    acquire(command) {
      return registry.pin(command.blockId, command.reason)
    },
    release(command) {
      return registry.unpin(command.blockId, command.reason)
    },
    releaseReason(reason) {
      return registry.unpinReason(reason)
    },
    hasReason(command) {
      return registry.getReasons(command.blockId).has(command.reason)
    },
  }
}

export function applyRenderVirtualizationKeepAliveCommand(
  input: ApplyRenderVirtualizationKeepAliveCommandInput
): boolean {
  if (input.active) {
    if (input.port) return input.port.acquire(input.command)
  } else if (input.port) {
    return input.port.release(input.command)
  }

  return dispatchRenderVirtualizationKeepAlive(input.legacyTarget ?? null, {
    blockId: input.command.blockId,
    reason: input.command.reason,
    active: input.active,
  })
}
