import { Logger } from '@plugin/backend/loggingRuntime';
import { registerKnowledgeToolRuntime } from './tools/runtime/knowledgeToolRuntime';
import { KnowledgePreparationFailure } from './runtime/definitions/knowledgePreparationFailure';
import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';
import { knowledgeManifest, knowledgePluginMeta } from '../shared';
import { knowledgePluginMigrations } from './database';
import { knowledgeToolClasses } from './tools';
import { knowledgeAgentDefinitions } from './agents';
import { createKnowledgeRuntime, type KnowledgeRuntime } from './runtime/orchestration/createKnowledgeRuntime';
import { createKnowledgeIpc } from './runtime/orchestration/createKnowledgeIpc';
import { createKnowledgeCli } from './cli/orchestration/createKnowledgeCli';

const logger = new Logger('KnowledgePlugin');
let runtime: KnowledgeRuntime | undefined;
let preparationFailure: KnowledgePreparationFailure | undefined;
let disposeTools: (() => void) | undefined;
function requireRuntime(): KnowledgeRuntime {
  if (preparationFailure) throw preparationFailure;
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
  pluginCli: createKnowledgeCli(requireRuntime),
  multipartUpload: { channel: 'upload-document' },
  rendererPush: { channels: ['task-status-updated', 'graph-progress-updated'] },
  runtimeEffects: [{
    id: 'knowledge-runtime',
    assertCanDeactivate: () => runtime?.assertCanDeactivate(),
    hasActiveWork: () => runtime?.hasActiveTasks() ?? false,
    async activate() {
      // 非必需插件自己的资料故障不阻断整个 App；Host 合同/注册错误仍照常失败。
      try { runtime = await createKnowledgeRuntime(); }
      catch (error) {
        if (!(error instanceof KnowledgePreparationFailure)) throw error;
        preparationFailure = error;
        logger.error('知识库资料初始化失败，其他项目继续可用', error.cause);
      }
      disposeTools = registerKnowledgeToolRuntime({
        get service() { return requireRuntime().service; },
        listProjectKnowledgeBaseIds: id => requireRuntime().toolRuntime.listProjectKnowledgeBaseIds(id),
        enterTool: () => requireRuntime().toolRuntime.enterTool(),
      });
    },
    async deactivate() {
      await runtime?.stop();
      // 收尾失败保留 owner，下一次操作可以继续等待，不能遗失仍活跃的资源。
      runtime = undefined;
      preparationFailure = undefined;
      disposeTools?.();
      disposeTools = undefined;
    },
  }],
};
export default contribution;
