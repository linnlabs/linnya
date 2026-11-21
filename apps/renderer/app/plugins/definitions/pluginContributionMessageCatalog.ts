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
  'plugins.contribution.documentType.recovery.enable': '启用插件',
  'plugins.contribution.documentType.recovery.openStore': '前往插件商店',
  'plugins.contribution.workspaceReference.error.outsideProject': '引用不在当前项目，无法预览或打开',
  'plugins.contribution.workspaceReference.error.pluginUnavailable': '需要启用或安装对应插件，请在预览中操作',
  'plugins.contribution.workspaceReference.error.unavailable': '引用文档当前不可访问',
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
      'plugins.contribution.documentType.recovery.enable': 'Enable plugin',
      'plugins.contribution.documentType.recovery.openStore': 'Go to plugin store',
      'plugins.contribution.workspaceReference.error.outsideProject':
        'This reference is not in the current project, so it cannot be previewed or opened.',
      'plugins.contribution.workspaceReference.error.pluginUnavailable':
        'Enable or install the required plugin from the preview to open this document.',
      'plugins.contribution.workspaceReference.error.unavailable':
        'The referenced document is not accessible right now.',
    },
  },
};
