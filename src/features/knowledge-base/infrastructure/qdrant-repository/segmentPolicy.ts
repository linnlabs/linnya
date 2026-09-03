/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/segmentPolicy.ts
 *
 * @brief 根据 points_count 决定 collection 的目标 segment 数
 */

export type CollectionTargetSegmentCount = 0 | 1 | 2 | 4;

type SegmentPolicyRule = {
  maxPointsInclusive: number;
  targetSegmentCount: Exclude<CollectionTargetSegmentCount, 0>;
};

const SEGMENT_POLICY_RULES: SegmentPolicyRule[] = [
  { maxPointsInclusive: 20_000, targetSegmentCount: 1 },
  { maxPointsInclusive: 100_000, targetSegmentCount: 2 },
  { maxPointsInclusive: 500_000, targetSegmentCount: 4 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * 功能：根据 points_count 计算目标段数。
 *
 * 说明：
 * - 对小 collection 显式收敛到 1/2/4 段，降低固定 segment 底座成本；
 * - 超出阈值后返回 0，表示回退到 Qdrant 默认自动策略（按 CPU 选择）。
 */
export function resolveTargetSegmentCountByPointsCount(pointsCount: number): CollectionTargetSegmentCount {
  const normalizedPointsCount =
    Number.isFinite(pointsCount) && pointsCount > 0 ? Math.trunc(pointsCount) : 0;

  for (const rule of SEGMENT_POLICY_RULES) {
    if (normalizedPointsCount <= rule.maxPointsInclusive) {
      return rule.targetSegmentCount;
    }
  }

  return 0;
}

/**
 * 功能：从 Qdrant collection config 中读取当前配置的目标段数。
 *
 * 说明：
 * - `optimizer_config.default_segment_number` 在 getCollection 返回里可能缺失；
 * - 缺失 / null / 0 均视为“自动策略”。
 */
export function readConfiguredTargetSegmentCount(
  config: Record<string, unknown>
): CollectionTargetSegmentCount {
  const optimizerConfig = config['optimizer_config'];
  if (!isRecord(optimizerConfig)) {
    return 0;
  }

  const raw = readFiniteNumber(optimizerConfig['default_segment_number']);
  if (raw === null || raw <= 0) {
    return 0;
  }

  if (raw === 1 || raw === 2 || raw === 4) {
    return raw;
  }

  // 兜底：若历史上被写成了其它正整数，视为“非标准手工配置”，此时不强行识别为 1/2/4。
  return 0;
}

/**
 * 功能：构造 Qdrant collection PATCH 所需的 optimizers_config。
 */
export function buildSegmentOptimizerPatch(
  targetSegmentCount: CollectionTargetSegmentCount
): Record<string, unknown> {
  return {
    optimizers_config: {
      default_segment_number: targetSegmentCount,
    },
  };
}

