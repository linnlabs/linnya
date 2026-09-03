/**
 * shouldEnableVirtualization.ts
 *
 * RootBlock 渲染虚拟化启用策略。
 *
 * 中文说明：
 * - 本模块保持纯函数，不直接读取 feature flag，也不碰 ProseMirror；
 * - 调用方把“当前开关是否开启、文档有多少 rootBlock、是否 Markdown 文档”显式传入；
 * - 这样后续灰度阈值、A/B 对照和测试都不会反向污染 NodeView / controller。
 */

export const DEFAULT_VIRTUAL_ROOT_BLOCK_THRESHOLD = 1500

export interface VirtualizationPolicyInput {
  /** feature flag `virtualRootBlockRendering` 的当前值 */
  flagEnabled: boolean
  /** 当前文档 rootBlock 数量 */
  rootBlockCount: number
  /** 当前文档是否走 Markdown 编辑器链路 */
  isMarkdownDocument?: boolean
  /** 灰度阈值，默认与 direct-state / Shell 大文档阈值保持一致 */
  threshold?: number
}

export interface VirtualizationPolicyDecision {
  enabled: boolean
  reason:
    | 'flag-disabled'
    | 'non-markdown-document'
    | 'below-threshold'
    | 'enabled'
  threshold: number
}

export function shouldEnableVirtualRootBlockRendering(
  input: VirtualizationPolicyInput
): VirtualizationPolicyDecision {
  const threshold = Number.isFinite(input.threshold)
    ? Math.max(1, Math.floor(input.threshold ?? DEFAULT_VIRTUAL_ROOT_BLOCK_THRESHOLD))
    : DEFAULT_VIRTUAL_ROOT_BLOCK_THRESHOLD

  if (!input.flagEnabled) {
    return { enabled: false, reason: 'flag-disabled', threshold }
  }

  if (input.isMarkdownDocument === false) {
    return { enabled: false, reason: 'non-markdown-document', threshold }
  }

  if (input.rootBlockCount < threshold) {
    return { enabled: false, reason: 'below-threshold', threshold }
  }

  return { enabled: true, reason: 'enabled', threshold }
}
