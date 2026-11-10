import { delimiter } from 'node:path';

export function resolveDevelopmentBackendDirectories(plugins, configured = '') {
  const additional = configured.split(delimiter).map(entry => entry.trim()).filter(Boolean);
  return [...new Set([...plugins.map(plugin => plugin.packageDir), ...additional])].join(delimiter);
}
