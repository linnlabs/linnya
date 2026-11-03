import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';
import { Logger } from '@plugin/backend/workspaceRuntime';
import { canvasManifest, canvasPluginMeta, CANVAS_CHANGED_CHANNEL, CANVAS_GROUPS_CHANGED_CHANNEL } from '../shared';
import type { CanvasDatabase } from './definitions/canvasDatabase';
import { createCanvasDocumentRuntime, type CanvasDocumentRuntime } from './orchestration/createCanvasDocumentRuntime';
import { createCanvasDocumentHook } from './adapters/createCanvasDocumentHook';
import { CANVAS_IPC_CHANNELS, registerCanvasIpc } from './adapters/registerCanvasIpc';
import { readCanvasServiceManagerDatabase } from './functions/readCanvasHostContext';
import { canvasPluginMigrations } from './persistence/migrations';
import { createCanvasHiddenWorkerDefinition } from './features/canvasRender';
import { resolveCanvasArtifactPaths } from './functions/resolveCanvasArtifactPaths';
import { createCanvasImageRuntime } from './orchestration/createCanvasImageRuntime';

/** 实例拥有运行态，测试与多个Host可分别装配，模块不保存可变的全局运行状态。 */
export function createCanvasBackendPlugin(): PluginBackendContribution {
  const paths = resolveCanvasArtifactPaths();
  const logger = new Logger('CanvasLifecycle');
  let byDatabase = new WeakMap<CanvasDatabase, CanvasDocumentRuntime>();
  const instances = new Set<CanvasDocumentRuntime>();
  const runtimeFor = (database: CanvasDatabase) => {
    let runtime = byDatabase.get(database);
    if (!runtime) { runtime = createCanvasDocumentRuntime(database); byDatabase.set(database, runtime); instances.add(runtime); }
    return runtime;
  };
  return {
    meta: canvasPluginMeta, ownedTables: canvasManifest.ownedTables, pluginMigrations: canvasPluginMigrations,
    documentTypeHooks: [createCanvasDocumentHook(runtimeFor)],
    rendererPush: { channels: [CANVAS_CHANGED_CHANNEL, CANVAS_GROUPS_CHANGED_CHANNEL] },
    hiddenWorkers: [createCanvasHiddenWorkerDefinition(paths)],
    skillResourceRoots: [paths.skillResourceRoot],
    ipc: { channels: CANVAS_IPC_CHANNELS, register(manager, register) {
      const database = readCanvasServiceManagerDatabase(manager), runtime = runtimeFor(database);
      registerCanvasIpc(database, runtime, createCanvasImageRuntime(database, runtime), register);
    } },
    runtimeEffects: [{ id: 'canvas-document-runtime', activate() {
      logger.debug('Canvas 已启用，文档运行态按数据库实例惰性装配');
    }, deactivate() {
      for (const runtime of instances) runtime.dispose();
      instances.clear(); byDatabase = new WeakMap();
    } }],
  };
}

export const backendPlugin = createCanvasBackendPlugin();
