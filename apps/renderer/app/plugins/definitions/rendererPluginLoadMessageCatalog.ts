import type { MessageCatalogContribution } from '@app/localization';
import type { RendererPluginLoadMessageKey } from './rendererPluginLoadMessages';

export const RENDERER_PLUGIN_LOAD_MESSAGE_FALLBACKS = {
  'plugins.runtimeLoad.failed.single': '插件“{pluginName}”未能加载，相关文档暂时无法打开。',
  'plugins.runtimeLoad.failed.multiple': '{count} 个插件未能加载：{pluginNames}。相关文档暂时无法打开。',
  'plugins.runtimeLoad.failed.generic': '插件未能加载，相关文档暂时无法打开。',
  'plugins.runtimeLoad.pluginNameSeparator': '、',
  'plugins.runtimeLoad.action.retry': '重试',
  'plugins.runtimeLoad.action.retrying': '正在重试…',
  'plugins.runtimeLoad.action.dismiss': '关闭提示',
} as const satisfies Readonly<Record<RendererPluginLoadMessageKey, string>>;

export const RENDERER_PLUGIN_LOAD_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'app-plugins-runtime-load',
  catalogs: {
    'zh-CN': RENDERER_PLUGIN_LOAD_MESSAGE_FALLBACKS,
    'en-US': {
      'plugins.runtimeLoad.failed.single': 'The "{pluginName}" plugin failed to load. Its documents can\'t be opened for now.',
      'plugins.runtimeLoad.failed.multiple': '{count} plugins failed to load: {pluginNames}. Their documents can\'t be opened for now.',
      'plugins.runtimeLoad.failed.generic': 'Plugins failed to load. Their documents can\'t be opened for now.',
      'plugins.runtimeLoad.pluginNameSeparator': ', ',
      'plugins.runtimeLoad.action.retry': 'Retry',
      'plugins.runtimeLoad.action.retrying': 'Retrying…',
      'plugins.runtimeLoad.action.dismiss': 'Dismiss',
    },
  },
};
