import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';
import { knowledgeManifest, knowledgePluginMeta } from '../shared';
import { knowledgePluginMigrations } from './database';
import { knowledgeToolClasses } from './tools';
import { knowledgeAgentDefinitions } from './agents';
import { createKnowledgeRuntime, type KnowledgeRuntime } from './runtime/orchestration/createKnowledgeRuntime';
import { createKnowledgeIpc } from './runtime/orchestration/createKnowledgeIpc';

let runtime: KnowledgeRuntime | undefined;
function requireRuntime(): KnowledgeRuntime {
  if (!runtime) throw new Error('知识库尚未启用，请启用插件后重试');
  return runtime;
}

const contribution: PluginBackendContribution = {
  meta: knowledgePluginMeta,
  ownedTables: knowledgeManifest.ownedTables,
  pluginMigrations: knowledgePluginMigrations,
  toolClasses: knowledgeToolClasses,
  agentDefinitions: knowledgeAgentDefinitions,
  ipc: createKnowledgeIpc(requireRuntime),
  multipartUpload: { channel: 'upload-document' },
  rendererPush: { channels: ['task-status-updated', 'graph-progress-updated'] },
  runtimeEffects: [{
    id: 'knowledge-runtime',
    assertCanDeactivate: () => runtime?.assertCanDeactivate(),
    hasActiveWork: () => runtime?.hasActiveTasks() ?? false,
    async activate() { runtime = await createKnowledgeRuntime(); },
    async deactivate() {
      await runtime?.stop();
      // 收尾失败保留 owner，下一次操作可以继续等待，不能遗失仍活跃的资源。
      runtime = undefined;
    },
  }],
};
export default contribution;
