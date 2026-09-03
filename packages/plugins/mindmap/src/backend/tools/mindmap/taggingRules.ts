import type { NodeTagging } from '@plugin/mindmap/shared';

/**
 * 节点语义类型推荐值（与前端保持一致）
 */
export const NODE_KIND = {
  HYPOTHESIS: 'hypothesis',
  QUESTION: 'question',
  CONCLUSION: 'conclusion',
} as const;

export type NodeKind = (typeof NODE_KIND)[keyof typeof NODE_KIND];

/**
 * 节点状态推荐值
 */
export const RECOMMENDED_STATUS = ['open', 'verified', 'refuted', 'closed'] as const;

export type TaggingStatusValue = (typeof RECOMMENDED_STATUS)[number];

/**
 * 置信度推荐值（字符串）
 */
export const RECOMMENDED_CONFIDENCE = ['high', 'medium', 'low'] as const;

export type TaggingConfidenceLevel = (typeof RECOMMENDED_CONFIDENCE)[number];

export type TaggingConfidenceValue = TaggingConfidenceLevel | number;

export function parseNodeKind(value: unknown): NodeKind | undefined {
  if (typeof value !== 'string') return undefined;
  switch (value) {
    case NODE_KIND.HYPOTHESIS:
    case NODE_KIND.QUESTION:
    case NODE_KIND.CONCLUSION:
      return value;
    default:
      return undefined;
  }
}

export function canSetStatusForKind(kind: NodeKind | undefined): boolean {
  return kind === NODE_KIND.HYPOTHESIS;
}

export function canSetConfidenceForKind(kind: NodeKind | undefined): boolean {
  return kind === NODE_KIND.HYPOTHESIS || kind === NODE_KIND.CONCLUSION;
}

export function isValidStatusValue(value: unknown): value is TaggingStatusValue {
  if (typeof value !== 'string') return false;
  return (RECOMMENDED_STATUS as readonly string[]).includes(value);
}

export function isValidConfidenceValue(value: unknown): value is TaggingConfidenceValue {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  return (RECOMMENDED_CONFIDENCE as readonly string[]).includes(value);
}

export function normalizeTaggingForKind(kind: NodeKind | undefined, tagging: NodeTagging | undefined): NodeTagging | undefined {
  if (!kind) return undefined;

  const next: NodeTagging = {};

  if (kind === NODE_KIND.HYPOTHESIS) {
    if (typeof tagging?.status === 'string') {
      next.status = tagging.status;
    }
    if (typeof tagging?.confidence === 'string' || typeof tagging?.confidence === 'number') {
      next.confidence = tagging.confidence;
    }
  }

  if (kind === NODE_KIND.CONCLUSION) {
    if (typeof tagging?.confidence === 'string' || typeof tagging?.confidence === 'number') {
      next.confidence = tagging.confidence;
    }
  }

  next.labels = { kind };

  return next;
}

export function hasDisallowedLabelKeys(labels: Record<string, string | number | boolean> | undefined): boolean {
  if (!labels) return false;
  return Object.keys(labels).some((key) => key !== 'kind');
}
