import type { WebSearchConfig, WebSearchSettings } from '../definitions/webSearchConfig';
import { defaultKeySourceForEngine } from './defaultWebSearchKeySource';
import { normalizeWebSearchConfig } from './normalizeWebSearchConfig';

/** 把按引擎持久化的权威设置投影为 Provider 工厂消费的当前生效配置。 */
export function projectActiveWebSearchConfig(settings: WebSearchSettings): WebSearchConfig {
  const slot = settings.slots[settings.engine];
  return normalizeWebSearchConfig({
    engine: settings.engine,
    keySource: slot?.keySource ?? defaultKeySourceForEngine(settings.engine),
    ...(slot?.byokKey ? { byokKey: slot.byokKey } : {}),
    ...(slot?.searxngBaseUrl ? { searxngBaseUrl: slot.searxngBaseUrl } : {}),
  });
}
