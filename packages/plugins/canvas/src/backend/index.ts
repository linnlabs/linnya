import type { PluginBackendContribution } from '@plugin/backend/pluginContribution';
import { createDocumentReferenceMarkdownRuntime } from '@plugin/backend/documentReferences';
import { createCanvasBackendCapabilities } from './orchestration/createCanvasBackendCapabilities';
import { createCanvasArrangementRuntime } from './orchestration/createCanvasArrangementRuntime';
import { executeCanvasCliCommand } from './orchestration/executeCanvasCliCommand';
import { createCanvasPluginCli } from './features/canvasCli';
import { createCanvasCliFailureProjector } from './adapters/projectCanvasCliFailure';
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
import { createCanvasPreviewCapability } from './adapters/createCanvasPreviewCapability';
import { createCanvasImageRuntime } from './orchestration/createCanvasImageRuntime';

/** 实例拥有运行态，测试与多个Host可分别装配，模块不保存可变的全局运行状态。 */
export function createCanvasBackendPlugin(): PluginBackendContribution {
  const paths = resolveCanvasArtifactPaths();
  const logger = new Logger('CanvasLifecycle');
  let capabilities: ReturnType<typeof createCanvasBackendCapabilities> | null = null;
  const capabilitiesFor = () => capabilities ??= createCanvasBackendCapabilities(paths.computationWorkerPath);
  let references = new WeakMap<CanvasDatabase, ReturnType<typeof createDocumentReferenceMarkdownRuntime>>();
  const referencesFor = (database: CanvasDatabase) => {
    let runtime = references.get(database);
    if (!runtime) { runtime = createDocumentReferenceMarkdownRuntime(database); references.set(database, runtime); }
    return runtime;
  };
  let byDatabase = new WeakMap<CanvasDatabase, CanvasDocumentRuntime>();
  const instances = new Set<CanvasDocumentRuntime>();
  const runtimeFor = (database: CanvasDatabase) => {
    let runtime = byDatabase.get(database);
    if (!runtime) { runtime = createCanvasDocumentRuntime(database, referencesFor(database)); byDatabase.set(database, runtime); instances.add(runtime); }
    return runtime;
  };
  const arrangements = new Set<ReturnType<typeof createCanvasArrangementRuntime>>();
  return {
    pluginCli: createCanvasPluginCli((command, context, root) => executeCanvasCliCommand(command, context, root, { capabilities: capabilitiesFor(), runtimeFor, referencesFor }), createCanvasCliFailureProjector(logger)),
    meta: canvasPluginMeta, ownedTables: canvasManifest.ownedTables, pluginMigrations: canvasPluginMigrations,
    documentTypeHooks: [createCanvasDocumentHook(runtimeFor, createCanvasPreviewCapability(capabilitiesFor))],
    rendererPush: { channels: [CANVAS_CHANGED_CHANNEL, CANVAS_GROUPS_CHANGED_CHANNEL] },
    hiddenWorkers: [createCanvasHiddenWorkerDefinition(paths)],
    skillResourceRoots: [paths.skillResourceRoot],
    ipc: { channels: CANVAS_IPC_CHANNELS, register(manager, register) {
      const database = readCanvasServiceManagerDatabase(manager), runtime = runtimeFor(database);
      const arrangement = createCanvasArrangementRuntime(database, runtime, capabilitiesFor()); arrangements.add(arrangement);
      registerCanvasIpc(database, runtime, createCanvasImageRuntime(database, runtime), register, arrangement);
    } },
    runtimeEffects: [{ id: 'canvas-document-runtime', activate() {
      logger.debug('Canvas 已启用，文档运行态按数据库实例惰性装配');
    }, async deactivate() {
      for (const arrangement of arrangements) arrangement.dispose(); arrangements.clear();
      await capabilities?.computation.dispose(); capabilities = null;
      for (const runtime of instances) runtime.dispose();
      instances.clear(); byDatabase = new WeakMap(); references = new WeakMap();
    } }],
  };
}

export const backendPlugin = createCanvasBackendPlugin();
