import { assertKnowledgeResourceAdmission } from 'src/app-hosts/linnya/plugin-registry/knowledgeResourceAdmission';
import { createRegisteredPluginVectorRuntime } from 'src/app-hosts/linnya/plugin-registry/pluginVectorRuntimeFactory';
import type { PluginVectorRuntime } from '@linnya/plugin-host-contract/backend/vectorRuntime';

export type * from '@linnya/plugin-host-contract/backend/vectorRuntime';

export function createPluginVectorRuntime(pluginId: string): PluginVectorRuntime {
  assertKnowledgeResourceAdmission(pluginId);
  return createRegisteredPluginVectorRuntime();
}
