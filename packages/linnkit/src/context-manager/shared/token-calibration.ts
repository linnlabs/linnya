import type {
  AgentSpecTokenEstimationPolicy,
  TokenRoute,
  TokenUsageCalibrationSample,
  TokenUsageCalibrationTrace,
} from '../../contracts';

interface TokenUsageCalibrationState {
  enabled: boolean;
  route?: TokenRoute;
  sampleCount: number;
  coefficient?: number;
  minSamples?: number;
  minCoefficient?: number;
  maxCoefficient?: number;
  sampleLedgerEntryIds?: string[];
}

interface BuildTokenUsageCalibrationInput {
  policy?: AgentSpecTokenEstimationPolicy['calibration'];
  route?: TokenRoute;
  samples?: readonly TokenUsageCalibrationSample[];
}

interface CalibrateTokenEstimateInput {
  localEstimateTokens: number;
  state: TokenUsageCalibrationState;
}

export interface CalibratedTokenEstimate {
  tokens: number;
  trace: TokenUsageCalibrationTrace;
}

const DEFAULT_MIN_SAMPLES = 3;
const DEFAULT_MIN_COEFFICIENT = 1;
const DEFAULT_MAX_COEFFICIENT = 4;

/**
 * 从 actual usage 样本计算上下文预算校准系数。
 *
 * 中文备注：校准只修正本地估算偏差，不改变 contextPolicy.budget；
 * 样本必须已经按 route 带上真实输入占用，避免把中转路由和官方路由混在一起。
 */
export function buildTokenUsageCalibrationState(
  input: BuildTokenUsageCalibrationInput,
): TokenUsageCalibrationState {
  const enabled = input.policy?.enabled === true;
  const minSamples = input.policy?.minSamples ?? DEFAULT_MIN_SAMPLES;
  const minCoefficient = input.policy?.minCoefficient ?? DEFAULT_MIN_COEFFICIENT;
  const maxCoefficient = input.policy?.maxCoefficient ?? DEFAULT_MAX_COEFFICIENT;

  const route = input.route;

  if (!enabled || !route) {
    return {
      enabled,
      route,
      sampleCount: 0,
      minSamples,
      minCoefficient,
      maxCoefficient,
    };
  }

  const matchingSamples = (input.samples ?? []).filter(sample => (
    sample.confidence === 'actual' &&
    sample.localEstimateTokens > 0 &&
    sample.actualInputTokens > 0 &&
    routeEquals(sample.route, route)
  ));

  if (matchingSamples.length < minSamples) {
    return {
      enabled,
      route,
      sampleCount: matchingSamples.length,
      minSamples,
      minCoefficient,
      maxCoefficient,
      sampleLedgerEntryIds: collectLedgerEntryIds(matchingSamples),
    };
  }

  const localTotal = matchingSamples.reduce((total, sample) => total + sample.localEstimateTokens, 0);
  const actualTotal = matchingSamples.reduce((total, sample) => total + sample.actualInputTokens, 0);
  const coefficient = clampCoefficient(actualTotal / localTotal, minCoefficient, maxCoefficient);

  return {
    enabled,
    route,
    sampleCount: matchingSamples.length,
    coefficient,
    minSamples,
    minCoefficient,
    maxCoefficient,
    sampleLedgerEntryIds: collectLedgerEntryIds(matchingSamples),
  };
}

export function calibrateTokenEstimate(input: CalibrateTokenEstimateInput): CalibratedTokenEstimate {
  const { localEstimateTokens, state } = input;
  const coefficient = state.coefficient;
  const shouldApply = state.enabled && coefficient !== undefined;
  const calibratedEstimateTokens = shouldApply
    ? Math.ceil(localEstimateTokens * coefficient)
    : localEstimateTokens;

  return {
    tokens: calibratedEstimateTokens,
    trace: {
      enabled: state.enabled,
      applied: shouldApply,
      ...(state.route ? { route: state.route } : {}),
      sampleCount: state.sampleCount,
      ...(state.coefficient !== undefined ? { coefficient: state.coefficient } : {}),
      ...(state.minSamples !== undefined ? { minSamples: state.minSamples } : {}),
      ...(state.minCoefficient !== undefined ? { minCoefficient: state.minCoefficient } : {}),
      ...(state.maxCoefficient !== undefined ? { maxCoefficient: state.maxCoefficient } : {}),
      localEstimateTokens,
      calibratedEstimateTokens,
      deltaTokens: calibratedEstimateTokens - localEstimateTokens,
      ...(state.sampleLedgerEntryIds && state.sampleLedgerEntryIds.length > 0
        ? { sampleLedgerEntryIds: state.sampleLedgerEntryIds }
        : {}),
    },
  };
}

function clampCoefficient(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function actualInputTokensForCalibration(input: {
  inputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number {
  return input.inputTokens + (input.cacheReadTokens ?? 0) + (input.cacheWriteTokens ?? 0);
}

function routeEquals(left: TokenRoute, right: TokenRoute): boolean {
  return (
    left.capabilityId === right.capabilityId &&
    left.baseURL === right.baseURL &&
    left.modelId === right.modelId &&
    left.endpointModelId === right.endpointModelId
  );
}

function collectLedgerEntryIds(samples: readonly TokenUsageCalibrationSample[]): string[] {
  return samples
    .map(sample => sample.ledgerEntryId)
    .filter((id): id is string => id !== undefined);
}
