import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';
import {
  SLIDES_IPC_CHANNELS,
  SLIDES_OWNED_TABLES,
  SLIDES_PLUGIN_META,
  SLIDES_PUSH_CHANNELS,
} from '@plugin/slides/shared';
import { isPluginRuntimeEnabled } from '@plugin/backend/pluginRuntime';
import {
  activateSharedPptCoordinatorRuntime,
  deactivateSharedPptCoordinatorRuntime,
} from './coordinator';
import { decorateSlidesToolContext } from './toolContext/decorateSlidesToolContext';
import { copyPresentationCoordinatorBindingToToolContext } from './tools/toolContextBinding';
import slidesAgent from './agents/slides_agent';
import { createSlidesDocumentHookRuntime } from './documentHook/createSlidesDocumentHookRuntime';
import { createPresentationDocumentTypeBackendHook } from './documentHook/presentationDocumentTypeBackendHook';
import { registerSlidesIpcHandlers } from './ipc/registerSlidesIpcHandlers';
import { slidesPluginMigrations } from './persistence/slidesPluginMigrations';
import { pptComposeProfile } from './sandbox/pptComposeProfile';
import { resolveSlidesSkillResourceRoots } from './skillResourceRoots';
import { slidesToolManifest } from './toolManifest';
import { createSlidesRasterWorkerDefinition } from './features/slideRasterWorker';
import {
  createBrushArtworkWorkerDefinition,
  createPresentationBrushArtworkGenerator,
} from './features/presentationBrushArtworkGeneration';
import { slidesPluginCli } from './features/presentationCli';

export type {
  SlidesDocumentHookRuntime,
  SlidesDocumentHookRuntimeFactory,
} from './documentHook/presentationDocumentHookRuntime';

export const SLIDES_BACKEND_AVAILABLE = true;

export const slidesAgentDefinitions = [slidesAgent] as const;

function wrapSlidesSelectedElementFence(content: string): string {
  const trimmedContent = content.trim();
  return trimmedContent
    ? `<selected_slides_element>\n${trimmedContent}\n</selected_slides_element>`
    : '<selected_slides_element />';
}

export const presentationDocumentTypeBackendHook = createPresentationDocumentTypeBackendHook(
  createSlidesDocumentHookRuntime,
);

/**
 * 阶段 5AZ：backend contribution 装配点已反转到插件包。
 *
 * 中文说明：
 * - coordinator factory、document hook runtime、IPC coordinator 装配已在 5BA
 *   随 `createPptCoordinator` 进包；
 * - 5BB：tool context decorator 也已进包，启停门禁与 VFS 解析改走通用平台门面
 *   `@plugin/backend/pluginRuntime` / `@plugin/backend/workspaceRuntime`，
 *   `slidesLegacyBackend` 过渡桥已整体删除；
 * - sandbox profile / agent / IPC registrar 本体均已归包。
 */
export const slidesBackendPlugin = {
  meta: SLIDES_PLUGIN_META,
  toolClasses: slidesToolManifest.classes,
  toolContextDecorators: [{
    toolNames: slidesToolManifest.allNames,
    decorate: decorateSlidesToolContext,
  }],
  toolContextBindingMigrators: [{
    migrate: copyPresentationCoordinatorBindingToToolContext,
  }],
  agentDefinitions: slidesAgentDefinitions,
  agentFences: [{
    kind: 'selected-slides-element',
    category: 'selection',
    llmRole: 'user',
    placement: 'before-current-user',
    lifetime: 'turn-only',
    // 中文说明：点选编辑的源码片段是 edit_file.old_string 的授权来源，
    // 不能被预算裁剪后让 agent 猜目标。
    mustKeep: true,
    maxBudgetFraction: 0.25,
    formatter: wrapSlidesSelectedElementFence,
  }],
  skillResourceRoots: resolveSlidesSkillResourceRoots(),
  documentTypeHooks: [{
    ...presentationDocumentTypeBackendHook,
    isEnabled: () => isPluginRuntimeEnabled(SLIDES_PLUGIN_META.id),
  }],
  ipc: {
    channels: SLIDES_IPC_CHANNELS,
    register: registerSlidesIpcHandlers,
  },
  rendererPush: {
    channels: SLIDES_PUSH_CHANNELS,
  },
  runtimeEffects: [{
    id: 'slides-ppt-coordinator',
    activate: () => activateSharedPptCoordinatorRuntime({
      brushArtworkGenerator: createPresentationBrushArtworkGenerator(),
    }),
    deactivate: deactivateSharedPptCoordinatorRuntime,
  }],
  sandboxProfiles: [pptComposeProfile],
  hiddenWorkers: [
    createSlidesRasterWorkerDefinition(),
    createBrushArtworkWorkerDefinition(),
  ],
  pluginCli: slidesPluginCli,
  ownedTables: SLIDES_OWNED_TABLES,
  pluginMigrations: slidesPluginMigrations,
} satisfies PluginBackendContribution;

export const backendPlugin = slidesBackendPlugin;
