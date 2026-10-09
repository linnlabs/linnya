import type { MessageCatalogContribution } from '@app/localization';
import type { PluginContributionMessageKey } from './pluginContributionMessages';

export const PLUGIN_CONTRIBUTION_MESSAGE_FALLBACKS = {
  'plugins.contribution.documentType.document.label': '文档',
  'plugins.contribution.documentType.document.createLabel': '新建文档',
  'plugins.contribution.documentType.document.defaultName': '未命名文档',
  'plugins.contribution.agentChoice.deepResearch.menuText': '旧版深度研究（暂不可用）',
  'plugins.contribution.agentChoice.deepResearch.pillText': '旧版研究不可用',
  'plugins.contribution.agentChoice.deepResearch.ariaLabel': '旧版深度研究已停止接收新任务。已有历史和暂停运行仍保留。',
} as const satisfies Readonly<Record<PluginContributionMessageKey, string>>;

export const PLUGIN_CONTRIBUTION_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'app-plugins',
  catalogs: {
    'zh-CN': PLUGIN_CONTRIBUTION_MESSAGE_FALLBACKS,
    'en-US': {
      'plugins.contribution.documentType.document.label': 'Document',
      'plugins.contribution.documentType.document.createLabel': 'New document',
      'plugins.contribution.documentType.document.defaultName': 'Untitled document',
      'plugins.contribution.agentChoice.deepResearch.menuText': 'Legacy deep research (unavailable)',
      'plugins.contribution.agentChoice.deepResearch.pillText': 'Legacy research unavailable',
      'plugins.contribution.agentChoice.deepResearch.ariaLabel': 'Legacy deep research no longer accepts new tasks. History and paused runs remain available.',
    },
  },
};
