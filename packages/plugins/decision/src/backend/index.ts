import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';
import { decisionManifest, decisionPluginMeta } from '../shared';
import { decisionAgent } from './agents/decision';
import { decisionPluginCli } from './features/decision-cli/orchestration/prepareDecisionCli';
import { decisionMigrations } from './features/decision-record/persistence/migrations';

export const backendPlugin: PluginBackendContribution = {
  meta: decisionPluginMeta,
  agentDefinitions: [decisionAgent],
  pluginCli: decisionPluginCli,
  ownedTables: decisionManifest.ownedTables,
  pluginMigrations: decisionMigrations,
};
