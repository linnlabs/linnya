import type { MessageCatalogContribution } from '@app/localization';
import type { PluginContributionMessageKey } from './pluginContributionMessages';

export const PLUGIN_CONTRIBUTION_MESSAGE_FALLBACKS = {
  'plugins.contribution.documentType.document.label': '文档',
  'plugins.contribution.documentType.document.createLabel': '新建文档',
  'plugins.contribution.documentType.document.defaultName': '未命名文档',
  'plugins.contribution.agentChoice.projectPlanning.menuText': '项目初始化',
  'plugins.contribution.agentChoice.projectPlanning.pillText': '项目初始化',
  'plugins.contribution.agentChoice.projectPlanning.ariaLabel': '梳理项目并生成起始文档。',
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
      'plugins.contribution.agentChoice.projectPlanning.menuText': 'Project setup',
      'plugins.contribution.agentChoice.projectPlanning.pillText': 'Project setup',
      'plugins.contribution.agentChoice.projectPlanning.ariaLabel': 'Clarify the project and create its starting documents.',
      'plugins.contribution.agentChoice.deepResearch.menuText': 'Research',
      'plugins.contribution.agentChoice.deepResearch.pillText': 'Research',
      'plugins.contribution.agentChoice.deepResearch.ariaLabel':
        'Investigate sources, independently review, and deliver an editable article.',
    },
  },
};
