import type { WebReadConfig, WebReadSettings } from '../definitions/webReadConfig';

export function projectActiveWebReadConfig(settings: WebReadSettings): WebReadConfig {
  if (settings.managedReader === 'none') {
    return {
      renderEnabled: settings.renderEnabled,
      managedReader: settings.managedReader,
    };
  }
  const byokKey = settings.slots[settings.managedReader]?.byokKey;
  return {
    renderEnabled: settings.renderEnabled,
    managedReader: settings.managedReader,
    ...(byokKey ? { byokKey } : {}),
  };
}
