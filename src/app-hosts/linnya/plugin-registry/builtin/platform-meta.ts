import type { PluginMeta } from '@app/schemas';

/** Platform 是 Host 自身拥有的必需插件，不来自外部分发 catalog。 */
export const PLATFORM_PLUGIN_META: PluginMeta = {
  id: 'platform',
  name: 'Linnya Platform',
  version: '1.0.0',
  description: '平台内置能力',
  developer: 'Linnya',
  builtin: true,
  required: true,
};
