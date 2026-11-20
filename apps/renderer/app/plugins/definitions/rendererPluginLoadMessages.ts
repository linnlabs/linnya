import type { MessageParams } from '@app/localization';

export type RendererPluginLoadMessageKey =
  | 'plugins.runtimeLoad.failed.single'
  | 'plugins.runtimeLoad.failed.multiple'
  | 'plugins.runtimeLoad.failed.generic'
  | 'plugins.runtimeLoad.pluginNameSeparator'
  | 'plugins.runtimeLoad.action.retry'
  | 'plugins.runtimeLoad.action.retrying'
  | 'plugins.runtimeLoad.action.dismiss';

export type RendererPluginLoadMessageResolver = (
  key: RendererPluginLoadMessageKey,
  params?: MessageParams,
) => string;
