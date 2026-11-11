import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  type WebSearchSettings,
} from '../definitions/webSearchConfig';
import { normalizeWebSearchConfig } from './normalizeWebSearchConfig';
import { isRecord } from '@linnya/foundation';

/** 单槽更新只切换当前指针；未提交新 Key 时保留该引擎已有凭证。 */
export function resolveWebSearchConfigUpdate(
  input: unknown,
  current: WebSearchSettings = DEFAULT_WEB_SEARCH_SETTINGS,
): WebSearchSettings {
  const next = normalizeWebSearchConfig(input);
  const inputIncludesKey = isRecord(input) && Object.prototype.hasOwnProperty.call(input, 'byokKey');
  const currentSlot = current.slots[next.engine];
  const byokKey = inputIncludesKey ? next.byokKey : currentSlot?.byokKey;
  return {
    engine: next.engine,
    slots: {
      ...current.slots,
      [next.engine]: {
        keySource: next.keySource,
        ...(byokKey ? { byokKey } : {}),
        ...(next.searxngBaseUrl ? { searxngBaseUrl: next.searxngBaseUrl } : {}),
      },
    },
  };
}
