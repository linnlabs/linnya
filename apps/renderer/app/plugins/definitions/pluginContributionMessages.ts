import type { MessageParams } from '@app/localization';

export type PluginContributionMessageKey =
  | 'plugins.contribution.documentType.document.label'
  | 'plugins.contribution.documentType.document.createLabel'
  | 'plugins.contribution.documentType.document.defaultName'
  | 'plugins.contribution.agentChoice.projectPlanning.menuText'
  | 'plugins.contribution.agentChoice.projectPlanning.pillText'
  | 'plugins.contribution.agentChoice.projectPlanning.ariaLabel'
  | 'plugins.contribution.agentChoice.deepResearch.menuText'
  | 'plugins.contribution.agentChoice.deepResearch.pillText'
  | 'plugins.contribution.agentChoice.deepResearch.ariaLabel';

export type PluginContributionMessageResolver = (
  key: PluginContributionMessageKey,
  params?: MessageParams,
) => string;
