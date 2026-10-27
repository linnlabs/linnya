import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';
import { decisionManifest, decisionPluginMeta } from '../shared';
import { decisionAgent } from './agents/decision';
import { decisionPluginCli } from './features/decision-cli/orchestration/prepareDecisionCli';
import { decisionMigrations } from './features/decision-record/persistence/migrations';

export const backendPlugin: PluginBackendContribution = {
  meta: decisionPluginMeta,
  agentDefinitions: [decisionAgent],
  pluginCli: decisionPluginCli,
  subagentTypes: [{
    type: 'decision_research', promptKey: 'research_v1',
    description: '完整受管研究：先用 linnya-decision research prepare 保存委托，再把回执里的 prompt 原样传入。研究包含调查、初稿、双评审和修订。',
    allowedCallerAgentIds: ['decision_agent'], inheritTurns: 0, inheritEnvironment: false,
    allowedSubagentTypes: ['research_investigation', 'research_investigation_review', 'research_argument_review', 'research_source_review'],
  }],
  ownedTables: decisionManifest.ownedTables,
  pluginMigrations: decisionMigrations,
};
