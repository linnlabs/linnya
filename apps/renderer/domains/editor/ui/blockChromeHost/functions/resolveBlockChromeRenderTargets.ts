import type { RootBlockRuntimeHandle } from '../../../features/RenderVirtualization';
import type { BlockChromeRenderPlan } from '../definitions/blockChromeRenderPlan';
import type { BlockChromeRenderTarget } from '../definitions/blockChromeRenderTarget';

export interface ResolveBlockChromeRenderTargetsInput {
  plans: readonly BlockChromeRenderPlan[];
  getRuntimeHandle: (blockId: string) => RootBlockRuntimeHandle | null;
}

/**
 * 把 Host 的渲染计划解析成可 Teleport 的 DOM 目标。
 *
 * 中文说明：
 * - render plan 是纯业务/状态计划，不直接持有 DOM；
 * - DOM 目标必须在 action-time 从 RootBlockRuntimeRegistry 读取，避免 Host 缓存过期元素；
 * - 未水合或 anchor 不可用的块直接跳过，继续保持 shadow/observe 语义。
 */
export function resolveBlockChromeRenderTargets(
  input: ResolveBlockChromeRenderTargetsInput
): BlockChromeRenderTarget[] {
  return input.plans.flatMap((plan) => {
    const handle = input.getRuntimeHandle(plan.blockId);
    const anchorElement = handle?.getChromeAnchor() ?? null;
    if (!anchorElement) return [];

    return [{
      plan,
      anchorElement,
    }];
  });
}

