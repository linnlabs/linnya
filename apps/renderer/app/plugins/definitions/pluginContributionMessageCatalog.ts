import type { MessageCatalogContribution } from '@app/localization';
import type { PluginContributionMessageKey } from './pluginContributionMessages';

export const PLUGIN_CONTRIBUTION_MESSAGE_FALLBACKS = {
  'plugins.contribution.documentType.document.label': '文档',
  'plugins.contribution.documentType.document.createLabel': '新建文档',
  'plugins.contribution.documentType.document.defaultName': '未命名文档',
  'plugins.contribution.agentChoice.deepResearch.menuText': '研究',
  'plugins.contribution.agentChoice.deepResearch.pillText': '研究',
  'plugins.contribution.agentChoice.deepResearch.ariaLabel':
    '查找资料、独立复核并交付可编辑的研究文章。',
} as const satisfies Readonly<Record<PluginContributionMessageKey, string>>;

export const PLUGIN_CONTRIBUTION_MESSAGE_CATALOG: MessageCatalogContribution = {
  owner: 'app-plugins',
  catalogs: {
    'zh-CN': PLUGIN_CONTRIBUTION_MESSAGE_FALLBACKS,
    'en-US': {
      'plugins.contribution.documentType.document.label': 'Document',
      'plugins.contribution.documentType.document.createLabel': 'New document',
      'plugins.contribution.documentType.document.defaultName': 'Untitled document',
      'plugins.contribution.agentChoice.deepResearch.menuText': 'Research',
      'plugins.contribution.agentChoice.deepResearch.pillText': 'Research',
      'plugins.contribution.agentChoice.deepResearch.ariaLabel':
        'Investigate sources, independently review, and deliver an editable article.',
    },
  },
};
