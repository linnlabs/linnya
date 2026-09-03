import type { DevelopmentDataStateObservation } from '../definitions/developmentDataState';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseDevelopmentDataState(source: string): DevelopmentDataStateObservation {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return {
      kind: 'invalid',
      reason: `状态文件不是合法 JSON：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!isRecord(value)) {
    return { kind: 'invalid', reason: '状态文件根节点必须是对象' };
  }
  if (!Number.isInteger(value.epoch) || typeof value.epoch !== 'number' || value.epoch < 1) {
    return { kind: 'invalid', reason: '状态文件 epoch 必须是正整数' };
  }
  if (typeof value.created_at !== 'string' || value.created_at.length === 0) {
    return { kind: 'invalid', reason: '状态文件 created_at 必须是非空字符串' };
  }
  if (typeof value.app_version !== 'string' || value.app_version.length === 0) {
    return { kind: 'invalid', reason: '状态文件 app_version 必须是非空字符串' };
  }

  return {
    kind: 'valid',
    state: {
      epoch: value.epoch,
      created_at: value.created_at,
      app_version: value.app_version,
    },
  };
}
