import {
  DEFAULT_WEB_READ_SETTINGS,
  type WebReadSettings,
} from '../definitions/webReadConfig';
import { normalizeWebReadConfig } from './normalizeWebReadConfig';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 更新当前 Reader 指针和渲染开关；未提交新 Key 时保留对应 Reader 原有凭证。 */
export function resolveWebReadConfigUpdate(
  input: unknown,
  current: WebReadSettings = DEFAULT_WEB_READ_SETTINGS,
): WebReadSettings {
  const next = normalizeWebReadConfig(input);
  if (next.managedReader === 'none') {
    return {
      renderEnabled: next.renderEnabled,
      managedReader: next.managedReader,
      slots: current.slots,
    };
  }
  const inputIncludesKey = isRecord(input)
    && Object.prototype.hasOwnProperty.call(input, 'byokKey');
  const byokKey = inputIncludesKey
    ? next.byokKey
    : current.slots[next.managedReader]?.byokKey;
  return {
    renderEnabled: next.renderEnabled,
    managedReader: next.managedReader,
    slots: {
      ...current.slots,
      [next.managedReader]: { ...(byokKey ? { byokKey } : {}) },
    },
  };
}
