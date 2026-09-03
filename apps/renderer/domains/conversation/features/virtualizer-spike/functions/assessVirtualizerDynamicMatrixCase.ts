import {
  VIRTUALIZER_DYNAMIC_MATRIX_ANCHOR_THRESHOLD_PX,
  VIRTUALIZER_DYNAMIC_MATRIX_EXPECTED_DRIFT_MIN_PX,
  VIRTUALIZER_DYNAMIC_MATRIX_OUTER_HEIGHT_THRESHOLD_PX,
  type VirtualizerDynamicExpectation,
  type VirtualizerDynamicGranularity,
  type VirtualizerDynamicPolicy,
  type VirtualizerDynamicScenario,
} from '../definitions/dynamicResizeMatrix';
import type { VirtualizerSpikeStabilityResult } from '../definitions/virtualizerSpike';

export function readVirtualizerDynamicExpectation(input: {
  readonly granularity: VirtualizerDynamicGranularity;
  readonly policy: VirtualizerDynamicPolicy;
  readonly scenario: VirtualizerDynamicScenario;
}): VirtualizerDynamicExpectation {
  if (input.scenario === 'bounded-nested-growth') return 'stable';
  return input.granularity === 'visual-row' && input.policy === 'fully-above'
    ? 'stable'
    : 'drift';
}

export function assessVirtualizerDynamicMatrixCase(input: {
  readonly expectation: VirtualizerDynamicExpectation;
  readonly granularity: VirtualizerDynamicGranularity;
  readonly policy: VirtualizerDynamicPolicy;
  readonly predicateCalls: number;
  readonly predicateMatches: number;
  readonly backwardScrollObserved: boolean;
  readonly scrollCorrectionPx: number;
  readonly outerHeightDeltaPx: number;
  readonly scenario: VirtualizerDynamicScenario;
  readonly stability: VirtualizerSpikeStabilityResult;
}): boolean {
  if (!input.backwardScrollObserved) return false;

  if (input.scenario === 'bounded-nested-growth') {
    return input.stability.passed
      && input.outerHeightDeltaPx < VIRTUALIZER_DYNAMIC_MATRIX_OUTER_HEIGHT_THRESHOLD_PX
      && input.scrollCorrectionPx < VIRTUALIZER_DYNAMIC_MATRIX_ANCHOR_THRESHOLD_PX;
  }

  const predicateObserved = input.policy === 'default'
    ? input.predicateCalls === 0
    : input.predicateCalls > 0;
  if (!predicateObserved) return false;

  if (input.policy === 'fully-above') {
    const placementMatched = input.granularity === 'visual-row'
      ? input.predicateMatches > 0
      : input.predicateMatches === 0;
    if (!placementMatched) return false;
  }

  if (input.expectation === 'stable') {
    return input.stability.passed;
  }

  // drift 期望只需证明"该配置无法稳定锚点"：maxDriftPx>=24 即为不稳定实证。
  // 不再断言 scrollCorrectionPx——它会把两类合法的 scrollTop 位移误判为作弊：
  // 1) prepend-resize：anchorTo:'end' 插行时必然写 scrollTop（prepend 锚定，正确）；
  // 2) default 策略：TanStack 自带补偿本就会写 scrollTop（正是"默认不可靠"的证据）。
  // 若真用反向写入伪造稳定，drift 会掉到阈值以下，已被上面的 maxDriftPx 判负。
  return input.stability.missingFrames === 0
    && input.stability.maxDriftPx >= VIRTUALIZER_DYNAMIC_MATRIX_EXPECTED_DRIFT_MIN_PX;
}
