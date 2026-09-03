import type {
  DevelopmentDataAdmissionDecision,
  DevelopmentDataStateObservation,
} from '../definitions/developmentDataState';

export function decideDevelopmentDataAdmission(input: {
  readonly directoryExists: boolean;
  readonly topLevelEntryCount: number;
  readonly observation: DevelopmentDataStateObservation;
  readonly requiredEpoch: number;
}): DevelopmentDataAdmissionDecision {
  if (!input.directoryExists || input.topLevelEntryCount === 0) {
    return { kind: 'initialize' };
  }

  if (input.observation.kind === 'missing') {
    return {
      kind: 'reject',
      observedEpoch: null,
      reason: '目录已有内容但缺少开发数据状态文件',
    };
  }
  if (input.observation.kind === 'invalid') {
    return {
      kind: 'reject',
      observedEpoch: null,
      reason: input.observation.reason,
    };
  }
  if (input.observation.state.epoch !== input.requiredEpoch) {
    return {
      kind: 'reject',
      observedEpoch: input.observation.state.epoch,
      reason: '开发数据 epoch 与当前代码基线不一致',
    };
  }

  return { kind: 'admit', state: input.observation.state };
}
