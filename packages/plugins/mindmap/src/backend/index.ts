import type { SubagentTypeContribution } from '@plugin/backend/agentRegistry';
import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';
import { isPluginRuntimeEnabled } from '@plugin/backend/pluginRuntime';
import {
  MINDMAP_OWNED_TABLES,
  MINDMAP_PLUGIN_ID,
  MINDMAP_PLUGIN_META,
  MindmapPromptKeys,
} from '@plugin/mindmap/shared';

import mindmapEditorSubagent from './agents/subagent_mindmap_editor';
import { mindmapDocumentTypeBackendHook } from './documentTypeHook';
import { registerMindMapDocumentHandlers } from './ipc/mindmap_document/document-ipc';
import { mindmapPluginMigrations } from './persistence/migrations';
import { mindmapToolManifest } from './tools/mindmap';

export const MINDMAP_BACKEND_AVAILABLE = true;

export { mindmapPluginMigrations } from './persistence/migrations';
export { mindmapDocumentTypeBackendHook } from './documentTypeHook';

/**
 * Mindmap 插件专属 AgentDefinition raw list。
 *
 * 中文说明：运行期是否暴露这些 agent 由 host 的 BackendPluginRegistry 决定；
 * 包入口只声明 Mindmap 能贡献什么，不读取 enabled 状态。
 */
export const mindmapAgentDefinitions = [
  mindmapEditorSubagent,
] as const;

export const MINDMAP_SUBAGENT_TYPES: readonly SubagentTypeContribution[] = [
  {
    type: 'mindmap_editor',
    promptKey: MindmapPromptKeys.SUBAGENT_MINDMAP_EDITOR,
    description: 'MindMap creation and editing with outline-oriented tools.',
  },
] as const;

export const MINDMAP_IPC_CHANNELS = [
  'mindmap-document:create',
  'mindmap-document:read',
  'mindmap-document:update',
] as const;

export const mindmapBackendPlugin = {
  meta: MINDMAP_PLUGIN_META,
  toolClasses: mindmapToolManifest.classes,
  agentDefinitions: mindmapAgentDefinitions,
  subagentTypes: MINDMAP_SUBAGENT_TYPES,
  ipc: {
    channels: MINDMAP_IPC_CHANNELS,
    register(tsServiceManager, registerBackendPluginIpcHandler) {
      registerMindMapDocumentHandlers(tsServiceManager, registerBackendPluginIpcHandler);
    },
  },
  ownedTables: MINDMAP_OWNED_TABLES,
  pluginMigrations: mindmapPluginMigrations,
  documentTypeHooks: [{
    ...mindmapDocumentTypeBackendHook,
    isEnabled: () => isPluginRuntimeEnabled(MINDMAP_PLUGIN_ID),
  }],
} satisfies PluginBackendContribution;

export const backendPlugin = mindmapBackendPlugin;
