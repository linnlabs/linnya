import type { NodeTagging } from '../types'

/**
 * 节点语义类型推荐值
 *
 * 中文说明：
 * - 仅用于“推理语义”场景（假设/问题/结论）
 * - 其他自定义类型暂不支持，避免语义漂移
 */
export const NODE_KIND = {
  HYPOTHESIS: 'hypothesis',
  QUESTION: 'question',
  CONCLUSION: 'conclusion',
} as const

export type NodeKind = (typeof NODE_KIND)[keyof typeof NODE_KIND]

/**
 * 节点状态推荐值
 */
export const TAGGING_STATUS = {
  OPEN: 'open',
  VERIFIED: 'verified',
  REFUTED: 'refuted',
  CLOSED: 'closed',
} as const

export type TaggingStatusValue = (typeof TAGGING_STATUS)[keyof typeof TAGGING_STATUS]

/**
 * 置信度推荐值（字符串）
 */
export const TAGGING_CONFIDENCE_LEVEL = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const

export type TaggingConfidenceLevel = (typeof TAGGING_CONFIDENCE_LEVEL)[keyof typeof TAGGING_CONFIDENCE_LEVEL]

export type TaggingConfidenceValue = TaggingConfidenceLevel | number

/**
 * 解析节点类型（只接受推荐值）
 */
export function parseNodeKind(value: unknown): NodeKind | undefined {
  if (typeof value !== 'string') return undefined
  switch (value) {
    case NODE_KIND.HYPOTHESIS:
    case NODE_KIND.QUESTION:
    case NODE_KIND.CONCLUSION:
      return value
    default:
      return undefined
  }
}

/**
 * 判断节点类型是否允许设置状态
 */
export function canSetStatusForKind(kind: NodeKind | undefined): boolean {
  return kind === NODE_KIND.HYPOTHESIS
}

/**
 * 判断节点类型是否允许设置置信度
 */
export function canSetConfidenceForKind(kind: NodeKind | undefined): boolean {
  return kind === NODE_KIND.HYPOTHESIS || kind === NODE_KIND.CONCLUSION
}

/**
 * 判断状态值是否合法
 */
export function isValidStatusValue(status: unknown): status is TaggingStatusValue {
  if (typeof status !== 'string') return false
  switch (status) {
    case TAGGING_STATUS.OPEN:
    case TAGGING_STATUS.VERIFIED:
    case TAGGING_STATUS.REFUTED:
    case TAGGING_STATUS.CLOSED:
      return true
    default:
      return false
  }
}

/**
 * 判断置信度值是否合法
 */
export function isValidConfidenceValue(confidence: unknown): confidence is TaggingConfidenceValue {
  if (typeof confidence === 'number') return Number.isFinite(confidence)
  if (typeof confidence !== 'string') return false
  switch (confidence) {
    case TAGGING_CONFIDENCE_LEVEL.HIGH:
    case TAGGING_CONFIDENCE_LEVEL.MEDIUM:
    case TAGGING_CONFIDENCE_LEVEL.LOW:
      return true
    default:
      return false
  }
}

/**
 * 规范化 tagging（确保与节点类型规则一致）
 *
 * 中文说明：
 * - 这是“规则维护”的核心入口
 * - kind 变化或任意打标写入时，必须经过规范化
 */
export function normalizeTaggingForKind(kind: NodeKind | undefined, tagging: NodeTagging | undefined): NodeTagging | undefined {
  if (!kind) return undefined

  const next: NodeTagging = {}

  if (kind === NODE_KIND.HYPOTHESIS) {
    if (typeof tagging?.status === 'string') {
      next.status = tagging.status
    }
    if (typeof tagging?.confidence === 'string' || typeof tagging?.confidence === 'number') {
      next.confidence = tagging.confidence
    }
  }

  if (kind === NODE_KIND.CONCLUSION) {
    if (typeof tagging?.confidence === 'string' || typeof tagging?.confidence === 'number') {
      next.confidence = tagging.confidence
    }
  }

  // kind 本身始终保留
  next.labels = { kind }

  return next
}

/**
 * 比较两个 tagging 是否一致（仅比较 status/confidence/labels）
 */
export function isSameTagging(a: NodeTagging | undefined, b: NodeTagging | undefined): boolean {
  if (!a && !b) return true
  if (!a || !b) return false
  if (a.status !== b.status) return false
  if (a.confidence !== b.confidence) return false

  const aLabels = a.labels ?? {}
  const bLabels = b.labels ?? {}
  const aKeys = Object.keys(aLabels)
  const bKeys = Object.keys(bLabels)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (aLabels[key] !== bLabels[key]) return false
  }
  return true
}
