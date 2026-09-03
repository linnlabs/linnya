import type { PluginId, PluginMeta, PluginStateView } from '@app/schemas';
import { ref, type Ref } from 'vue';
import { ConversationSelectedAgentIdSchema } from '@app/schemas';
import type { RuntimeRendererPluginLoaderDiagnostics } from './loader/runtimeRendererPluginLoader';
import type {
  DocumentActionMenuContribution,
  ConversationAgentChoiceContribution,
  DocumentRuntimeLoaderContribution,
  DocumentTypeContribution,
  RendererPluginContribution,
} from './types';
import type { ToolUiEntry } from '@linnya/plugin-host-contract/renderer/toolUi';
import {
  getRegisteredDocumentTypeByActiveType,
  getRegisteredDocumentTypeByCreateRequestType,
  getRegisteredDocumentTypeByFileSessionType,
  getRegisteredDocumentTypeByNodeType,
  listRegisteredDocumentTypes,
  registerDocumentType,
  unregisterDocumentType,
  clearRegisteredDocumentTypesForTest,
} from './documentTypeRegistry';
import {
  registerPluginConversationInputContribution,
  removePluginComposerDraftReferences,
  unregisterPluginConversationInputContribution,
} from './orchestration/pluginConversationInputLifecycle';

export type DocumentTypeAvailability =
  | { state: 'enabled'; documentType: DocumentTypeContribution }
  | { state: 'disabled'; documentType: DocumentTypeContribution }
  | { state: 'missing'; activeDocumentType: string };

export type DocumentNodeTypeAvailability =
  | { state: 'enabled'; documentType: DocumentTypeContribution }
  | {
      state: 'disabled';
      nodeType: string;
      pluginId: PluginId;
      pluginName: string;
      label: string;
      extension?: string;
      documentType?: DocumentTypeContribution;
    }
  | {
      state: 'missing';
      nodeType: string;
      pluginId: PluginId;
      pluginName: string;
      label: string;
      extension?: string;
    }
  | {
      state: 'load-failed';
      nodeType: string;
      pluginId: PluginId;
      pluginName: string;
      label: string;
      extension?: string;
    }
  | { state: 'unknown'; nodeType: string };

export interface RendererPluginRegistryDiagnostics {
  readonly registeredPluginIds: readonly PluginId[];
  readonly activePluginIds: readonly PluginId[];
  readonly documentTypes: readonly {
    readonly pluginId: PluginId;
    readonly nodeType: string;
    readonly activeDocumentType: string;
    readonly fileSessionType?: string;
    readonly createRequestType: string;
    readonly label: string;
  }[];
  readonly toolCards: readonly {
    readonly name: string;
    readonly pluginId: PluginId;
  }[];
  readonly documentActionMenus: readonly {
    readonly activeDocumentType: string;
    readonly pluginId: PluginId;
  }[];
  readonly documentRuntimeLoaders: readonly {
    readonly activeDocumentType: string;
    readonly pluginId: PluginId;
  }[];
  readonly conversationAgentChoices: readonly {
    readonly id: string;
    readonly pluginId: PluginId;
  }[];
  readonly conversationInputs: readonly {
    readonly pluginId: PluginId;
    readonly active: boolean;
    readonly referenceKinds: readonly string[];
    readonly referenceProviders: readonly string[];
    readonly accessories: readonly string[];
  }[];
  readonly subrunWorkers: readonly {
    readonly pluginId: PluginId;
    readonly id: string;
    readonly promptKey: string;
  }[];
}

interface ToolCardContribution {
  pluginId: PluginId;
  entry: ToolUiEntry;
}

interface DocumentActionMenuRegistration {
  pluginId: PluginId;
  contribution: DocumentActionMenuContribution;
}

interface DocumentRuntimeLoaderRegistration {
  pluginId: PluginId;
  contribution: DocumentRuntimeLoaderContribution;
}

interface ConversationAgentChoiceRegistration {
  pluginId: PluginId;
  contribution: ConversationAgentChoiceContribution;
}

const pluginMetas = new Map<PluginId, PluginMeta>();
const rendererPluginContributions = new Map<PluginId, RendererPluginContribution>();
const toolCards = new Map<string, ToolCardContribution>();
const documentActionMenus = new Map<string, DocumentActionMenuRegistration>();
const documentRuntimeLoaders = new Map<string, DocumentRuntimeLoaderRegistration>();
const conversationAgentChoices = new Map<string, ConversationAgentChoiceRegistration>();
const activeRendererPlugins = new Set<PluginId>();
const rendererPluginRegistryRevision = ref(0);
const loadFailedDocumentTypeDiagnosticsLastLoggedAt = new Map<string, number>();

declare global {
  // 中文说明：registry 是文档打开判断的底层，不反向运行时 import loader，避免形成环依赖。
  // loader 会把最近一次同步诊断发布到这里；registry 只在打开被阻断时读取并打印。
  var __LINNYA_RENDERER_PLUGIN_LOADER_DIAGNOSTICS__: RuntimeRendererPluginLoaderDiagnostics | undefined;
}

function bumpRendererPluginRegistryRevision(): void {
  rendererPluginRegistryRevision.value += 1;
}

/**
 * Accessory 的可见性在 conversation computed 内读取；显式触碰 revision 才能让
 * activate 完成后的 Set 变化进入 Vue 依赖图。Provider 的命令式查询也复用同一口径。
 */
function readRendererPluginActiveState(pluginId: PluginId): boolean {
  void rendererPluginRegistryRevision.value;
  return activeRendererPlugins.has(pluginId);
}

export function useRendererPluginRegistryRevision(): Readonly<Ref<number>> {
  return rendererPluginRegistryRevision;
}

function unregisterToolCardsForPlugin(pluginId: PluginId): void {
  for (const [name, contribution] of Array.from(toolCards.entries())) {
    if (contribution.pluginId === pluginId) {
      toolCards.delete(name);
    }
  }
}

function unregisterDocumentActionMenusForPlugin(pluginId: PluginId): void {
  for (const [activeDocumentType, registration] of Array.from(documentActionMenus.entries())) {
    if (registration.pluginId === pluginId) {
      documentActionMenus.delete(activeDocumentType);
    }
  }
}

function unregisterDocumentRuntimeLoadersForPlugin(pluginId: PluginId): void {
  for (const [activeDocumentType, registration] of Array.from(documentRuntimeLoaders.entries())) {
    if (registration.pluginId === pluginId) {
      documentRuntimeLoaders.delete(activeDocumentType);
    }
  }
}

function unregisterConversationAgentChoicesForPlugin(pluginId: PluginId): void {
  for (const [agentChoiceId, registration] of Array.from(conversationAgentChoices.entries())) {
    if (registration.pluginId === pluginId) {
      conversationAgentChoices.delete(agentChoiceId);
    }
  }
}

function registerToolCard(pluginId: PluginId, name: string, entry: ToolUiEntry): void {
  if (!name.trim()) {
    throw new Error('[rendererPluginRegistry] toolCard 名称不能为空');
  }
  if (toolCards.has(name)) {
    throw new Error(`[rendererPluginRegistry] toolCard 冲突: ${name}`);
  }
  toolCards.set(name, { pluginId, entry });
}

function registerDocumentActionMenu(
  pluginId: PluginId,
  contribution: DocumentActionMenuContribution,
): void {
  const activeDocumentType = contribution.activeDocumentType.trim();
  if (!activeDocumentType) {
    throw new Error('[rendererPluginRegistry] documentActionMenu 缺少 activeDocumentType');
  }
  if (documentActionMenus.has(activeDocumentType)) {
    throw new Error(`[rendererPluginRegistry] documentActionMenu 冲突: ${activeDocumentType}`);
  }
  documentActionMenus.set(activeDocumentType, {
    pluginId,
    contribution: {
      ...contribution,
      activeDocumentType,
    },
  });
}

function registerDocumentRuntimeLoader(
  pluginId: PluginId,
  contribution: DocumentRuntimeLoaderContribution,
): void {
  const activeDocumentType = contribution.activeDocumentType.trim();
  if (!activeDocumentType) {
    throw new Error('[rendererPluginRegistry] documentRuntimeLoader 缺少 activeDocumentType');
  }
  if (documentRuntimeLoaders.has(activeDocumentType)) {
    throw new Error(`[rendererPluginRegistry] documentRuntimeLoader 冲突: ${activeDocumentType}`);
  }
  documentRuntimeLoaders.set(activeDocumentType, {
    pluginId,
    contribution: {
      ...contribution,
      activeDocumentType,
    },
  });
}

function registerConversationAgentChoice(
  pluginId: PluginId,
  contribution: ConversationAgentChoiceContribution,
): void {
  const agentChoiceId = contribution.id.trim();
  if (!agentChoiceId) {
    throw new Error('[rendererPluginRegistry] conversationAgentChoice 缺少 id');
  }
  if (conversationAgentChoices.has(agentChoiceId)) {
    throw new Error(`[rendererPluginRegistry] conversationAgentChoice 冲突: ${agentChoiceId}`);
  }
  const agentId = ConversationSelectedAgentIdSchema.parse(contribution.agentId);
  conversationAgentChoices.set(agentChoiceId, {
    pluginId,
    contribution: {
      ...contribution,
      id: agentChoiceId,
      agentId,
    },
  });
}

function validateSubrunWorkers(contribution: RendererPluginContribution): void {
  const ids = new Set<string>();
  for (const worker of contribution.subrunWorkers ?? []) {
    const id = worker.id.trim();
    const promptKey = worker.promptKey.trim();
    if (!id || !promptKey) {
      throw new Error('[rendererPluginRegistry] subrun worker id/promptKey 不能为空');
    }
    if (id !== worker.id || promptKey !== worker.promptKey) {
      throw new Error('[rendererPluginRegistry] subrun worker id/promptKey 不能包含首尾空白');
    }
    if (ids.has(id)) {
      throw new Error(`[rendererPluginRegistry] subrun worker 重复声明: ${contribution.meta.id}:${id}`);
    }
    ids.add(id);
  }
}

function isEnabledPlugin(pluginId: PluginId, enabledPluginIds: ReadonlySet<PluginId>): boolean {
  return enabledPluginIds.has(pluginId);
}

function findPluginState(pluginId: PluginId, pluginStates?: readonly PluginStateView[] | null): PluginStateView | null {
  return pluginStates?.find(state => state.meta.id === pluginId) ?? null;
}

function findOwnedFileTypeStateByNodeType(
  nodeType: string,
  pluginStates?: readonly PluginStateView[] | null,
): {
  readonly pluginState: PluginStateView;
  readonly ownedFileType: NonNullable<PluginMeta['ownedFileTypes']>[number];
} | null {
  if (!pluginStates) return null;
  for (const pluginState of pluginStates) {
    const ownedFileType = pluginState.meta.ownedFileTypes?.find(item => item.nodeType === nodeType);
    if (ownedFileType) {
      return { pluginState, ownedFileType };
    }
  }
  return null;
}

function summarizeLoaderError(error: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!error) return null;
  return {
    name: error.name ?? null,
    message: error.message ?? null,
  };
}

function summarizeRendererLoaderDiagnostics(
  loader: RuntimeRendererPluginLoaderDiagnostics | undefined,
  pluginId: PluginId,
): Record<string, unknown> {
  if (!loader) {
    return {
      status: 'not-published',
      reason: 'runtime renderer loader 尚未发布任何诊断，说明 loader 可能还没执行到入口读取阶段。',
    };
  }

  return {
    runId: loader.runId,
    status: loader.status,
    startedAt: loader.startedAt,
    completedAt: loader.completedAt,
    entryCount: loader.entries.length,
    matchingEntry: loader.entries.find((entry) => entry.pluginId === pluginId) ?? null,
    failureCount: loader.sync?.failures.length ?? 0,
    matchingFailure: loader.sync?.failures.find((failure) => failure.entry.pluginId === pluginId) ?? null,
    failures: loader.sync?.failures.map((failure) => ({
      pluginId: failure.entry.pluginId,
      version: failure.entry.version,
      phase: failure.phase,
      sourceKind: failure.entry.sourceKind,
      entryUrl: failure.entry.entryUrl,
      pluginDir: failure.entry.pluginDir,
      entryPath: failure.entry.entryPath,
      error: summarizeLoaderError(failure.error),
    })) ?? [],
    error: summarizeLoaderError(loader.error),
  };
}

function logEnabledPluginDocumentTypeLoadFailed(options: {
  readonly nodeType: string;
  readonly pluginState: PluginStateView;
  readonly ownedFileType: NonNullable<PluginMeta['ownedFileTypes']>[number];
}): void {
  const pluginId = options.pluginState.meta.id;
  const logKey = `${pluginId}:${options.nodeType}`;
  const now = Date.now();
  const lastLoggedAt = loadFailedDocumentTypeDiagnosticsLastLoggedAt.get(logKey) ?? 0;
  if (now - lastLoggedAt < 5000) return;
  loadFailedDocumentTypeDiagnosticsLastLoggedAt.set(logKey, now);

  console.error('[rendererPluginRegistry] document-type-load-failed-diagnostics', {
    reason: '后端插件状态是 enabled，但 renderer registry 没有注册该 nodeType 对应的 documentType。',
    nodeType: options.nodeType,
    plugin: {
      id: pluginId,
      name: options.pluginState.meta.name,
      version: options.pluginState.meta.version,
      state: options.pluginState.state,
    },
    ownedFileType: options.ownedFileType,
    registry: describeRendererPluginRegistryForDiagnostics(),
    loader: summarizeRendererLoaderDiagnostics(
      globalThis.__LINNYA_RENDERER_PLUGIN_LOADER_DIAGNOSTICS__,
      pluginId,
    ),
  });
}

export function registerRendererPlugin(contribution: RendererPluginContribution): void {
  if (!contribution.meta.id.trim()) {
    throw new Error('[rendererPluginRegistry] 插件 ID 不能为空');
  }
  if (pluginMetas.has(contribution.meta.id)) {
    throw new Error(`[rendererPluginRegistry] 插件重复注册: ${contribution.meta.id}`);
  }

  const pluginId = contribution.meta.id;
  validateSubrunWorkers(contribution);
  try {
    pluginMetas.set(pluginId, contribution.meta);
    rendererPluginContributions.set(pluginId, contribution);

    for (const documentType of contribution.documentTypes ?? []) {
      registerDocumentType(documentType);
    }

    for (const [name, entry] of Object.entries(contribution.toolCards ?? {})) {
      registerToolCard(pluginId, name, entry);
    }

    for (const documentActionMenu of contribution.documentActionMenus ?? []) {
      registerDocumentActionMenu(pluginId, documentActionMenu);
    }

    for (const documentRuntimeLoader of contribution.documentRuntimeLoaders ?? []) {
      registerDocumentRuntimeLoader(pluginId, documentRuntimeLoader);
    }

    for (const conversationAgentChoice of contribution.conversationAgentChoices ?? []) {
      registerConversationAgentChoice(pluginId, conversationAgentChoice);
    }
    bumpRendererPluginRegistryRevision();
  } catch (error) {
    unregisterRendererPluginContribution(pluginId, contribution);
    throw error;
  }
}

export function unregisterRendererPluginContribution(
  pluginId: PluginId,
  expectedContribution?: RendererPluginContribution,
): boolean {
  const currentContribution = rendererPluginContributions.get(pluginId);
  if (!currentContribution) {
    return false;
  }
  if (expectedContribution && currentContribution !== expectedContribution) {
    return false;
  }

  if (currentContribution.conversationInput) {
    if (activeRendererPlugins.has(pluginId)) {
      removePluginComposerDraftReferences(pluginId);
    }
    unregisterPluginConversationInputContribution(currentContribution.conversationInput);
  }
  activeRendererPlugins.delete(pluginId);
  for (const documentType of currentContribution.documentTypes ?? []) {
    unregisterDocumentType(documentType.activeDocumentType, documentType);
  }
  unregisterToolCardsForPlugin(pluginId);
  unregisterDocumentActionMenusForPlugin(pluginId);
  unregisterDocumentRuntimeLoadersForPlugin(pluginId);
  unregisterConversationAgentChoicesForPlugin(pluginId);
  rendererPluginContributions.delete(pluginId);
  pluginMetas.delete(pluginId);
  bumpRendererPluginRegistryRevision();
  return true;
}

export function hasRendererPlugin(pluginId: PluginId): boolean {
  return pluginMetas.has(pluginId);
}

export async function activateRendererPlugin(pluginId: PluginId): Promise<void> {
  if (activeRendererPlugins.has(pluginId)) return;
  const contribution = getRendererPluginContribution(pluginId);
  if (!contribution) {
    throw new Error(`[rendererPluginRegistry] 插件未注册，不能激活: ${pluginId}`);
  }
  const conversationInput = contribution.conversationInput;
  if (conversationInput) {
    registerPluginConversationInputContribution({
      pluginId,
      contribution: conversationInput,
      isPluginActive: () => readRendererPluginActiveState(pluginId),
    });
  }
  try {
    await contribution.activate?.();
    activeRendererPlugins.add(pluginId);
    bumpRendererPluginRegistryRevision();
  } catch (error) {
    if (conversationInput) {
      unregisterPluginConversationInputContribution(conversationInput);
    }
    throw error;
  }
}

export async function deactivateRendererPlugin(pluginId: PluginId): Promise<void> {
  if (!activeRendererPlugins.has(pluginId)) return;
  const contribution = getRendererPluginContribution(pluginId);
  await contribution?.deactivate?.();
  if (contribution?.conversationInput) {
    removePluginComposerDraftReferences(pluginId);
    unregisterPluginConversationInputContribution(contribution.conversationInput);
  }
  activeRendererPlugins.delete(pluginId);
  bumpRendererPluginRegistryRevision();
}

export function listActiveRendererPluginIds(): readonly PluginId[] {
  return Array.from(activeRendererPlugins.values()).sort();
}

export function describeRendererPluginRegistryForDiagnostics(): RendererPluginRegistryDiagnostics {
  return {
    registeredPluginIds: Array.from(pluginMetas.keys()).sort(),
    activePluginIds: listActiveRendererPluginIds(),
    documentTypes: listRegisteredDocumentTypes()
      .map((documentType) => ({
        pluginId: documentType.pluginId,
        nodeType: documentType.nodeType,
        activeDocumentType: documentType.activeDocumentType,
        fileSessionType: documentType.fileSessionType,
        createRequestType: documentType.createRequestType,
        label: documentType.label,
      }))
      .sort((a, b) => a.nodeType.localeCompare(b.nodeType)),
    toolCards: Array.from(toolCards.entries())
      .map(([name, contribution]) => ({
        name,
        pluginId: contribution.pluginId,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    documentActionMenus: Array.from(documentActionMenus.entries())
      .map(([activeDocumentType, registration]) => ({
        activeDocumentType,
        pluginId: registration.pluginId,
      }))
      .sort((a, b) => a.activeDocumentType.localeCompare(b.activeDocumentType)),
    documentRuntimeLoaders: Array.from(documentRuntimeLoaders.entries())
      .map(([activeDocumentType, registration]) => ({
        activeDocumentType,
        pluginId: registration.pluginId,
      }))
      .sort((a, b) => a.activeDocumentType.localeCompare(b.activeDocumentType)),
    conversationAgentChoices: Array.from(conversationAgentChoices.entries())
      .map(([id, registration]) => ({
        id,
        pluginId: registration.pluginId,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    conversationInputs: Array.from(rendererPluginContributions.entries())
      .flatMap(([pluginId, contribution]) => contribution.conversationInput
        ? [{
            pluginId,
            active: activeRendererPlugins.has(pluginId),
            referenceKinds: contribution.conversationInput.referenceKinds
              .map(kind => kind.kind)
              .sort(),
            referenceProviders: contribution.conversationInput.referenceProviders
              .map(provider => provider.id)
              .sort(),
            accessories: (contribution.conversationInput.accessories ?? [])
              .map(accessory => accessory.id)
              .sort(),
          }]
        : [])
      .sort((a, b) => a.pluginId.localeCompare(b.pluginId)),
    subrunWorkers: Array.from(rendererPluginContributions.entries())
      .flatMap(([pluginId, contribution]) => (contribution.subrunWorkers ?? []).map(worker => ({
        pluginId,
        id: worker.id,
        promptKey: worker.promptKey,
      })))
      .sort((a, b) => `${a.pluginId}:${a.id}`.localeCompare(`${b.pluginId}:${b.id}`)),
  };
}

export function requireActiveConversationSubrunWorker(
  pluginId: PluginId,
  workerId: string,
): { readonly promptKey: string } {
  if (!activeRendererPlugins.has(pluginId)) {
    throw new Error(`[rendererPluginRegistry] 插件未激活，不能发起 subrun: ${pluginId}`);
  }
  const worker = rendererPluginContributions.get(pluginId)?.subrunWorkers
    ?.find(candidate => candidate.id === workerId);
  if (!worker) {
    throw new Error(`[rendererPluginRegistry] subrun worker 未声明: ${pluginId}:${workerId}`);
  }
  return { promptKey: worker.promptKey };
}

export function getRendererPluginContribution(pluginId: PluginId): RendererPluginContribution | null {
  return rendererPluginContributions.get(pluginId) ?? null;
}

export function getDocumentTypeByActiveType(activeDocumentType: string): DocumentTypeContribution | null {
  return getRegisteredDocumentTypeByActiveType(activeDocumentType);
}

export function getDocumentTypeByNodeType(nodeType: string): DocumentTypeContribution | null {
  return getRegisteredDocumentTypeByNodeType(nodeType);
}

export function getDocumentTypeByCreateRequestType(createRequestType: string): DocumentTypeContribution | null {
  return getRegisteredDocumentTypeByCreateRequestType(createRequestType);
}

export function getDocumentTypeByFileSessionType(fileSessionType: string): DocumentTypeContribution | null {
  return getRegisteredDocumentTypeByFileSessionType(fileSessionType);
}

export function resolveDocumentTypeByActiveType(
  activeDocumentType: string,
  enabledPluginIds: ReadonlySet<PluginId>,
): DocumentTypeAvailability {
  const documentType = getDocumentTypeByActiveType(activeDocumentType);
  if (!documentType) {
    return { state: 'missing', activeDocumentType };
  }
  if (!isEnabledPlugin(documentType.pluginId, enabledPluginIds)) {
    return { state: 'disabled', documentType };
  }
  return { state: 'enabled', documentType };
}

export function resolveDocumentTypeByNodeType(
  nodeType: string,
  enabledPluginIds: ReadonlySet<PluginId>,
  pluginStates?: readonly PluginStateView[] | null,
): DocumentNodeTypeAvailability {
  const documentType = getDocumentTypeByNodeType(nodeType);
  if (documentType) {
    if (isEnabledPlugin(documentType.pluginId, enabledPluginIds)) {
      return { state: 'enabled', documentType };
    }
    const pluginState = findPluginState(documentType.pluginId, pluginStates);
    if (pluginState?.state === 'missing') {
      return {
        state: 'missing',
        nodeType,
        pluginId: documentType.pluginId,
        pluginName: pluginState.meta.name,
        label: documentType.label,
        extension: pluginState.meta.ownedFileTypes?.find(item => item.nodeType === nodeType)?.extension,
      };
    }
    return {
      state: 'disabled',
      nodeType,
      pluginId: documentType.pluginId,
      pluginName: pluginState?.meta.name ?? documentType.label,
      label: documentType.label,
      extension: pluginState?.meta.ownedFileTypes?.find(item => item.nodeType === nodeType)?.extension,
      documentType,
    };
  }

  const owned = findOwnedFileTypeStateByNodeType(nodeType, pluginStates);
  if (!owned) {
    return { state: 'unknown', nodeType };
  }

  if (owned.pluginState.state === 'enabled') {
    logEnabledPluginDocumentTypeLoadFailed({
      nodeType,
      pluginState: owned.pluginState,
      ownedFileType: owned.ownedFileType,
    });
    return {
      state: 'load-failed',
      nodeType,
      pluginId: owned.pluginState.meta.id,
      pluginName: owned.pluginState.meta.name,
      label: owned.ownedFileType.label,
      extension: owned.ownedFileType.extension,
    };
  }

  if (owned.pluginState.state === 'disabled') {
    return {
      state: 'disabled',
      nodeType,
      pluginId: owned.pluginState.meta.id,
      pluginName: owned.pluginState.meta.name,
      label: owned.ownedFileType.label,
      extension: owned.ownedFileType.extension,
    };
  }

  return {
    state: 'missing',
    nodeType,
    pluginId: owned.pluginState.meta.id,
    pluginName: owned.pluginState.meta.name,
    label: owned.ownedFileType.label,
    extension: owned.ownedFileType.extension,
  };
}

export function listDocumentTypes(): readonly DocumentTypeContribution[] {
  return listRegisteredDocumentTypes();
}

export function listRendererPluginMetas(): readonly PluginMeta[] {
  return Array.from(pluginMetas.values())
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listCreatableDocumentTypes(): readonly DocumentTypeContribution[] {
  return listDocumentTypes().filter((documentType) => documentType.createRequestType.trim().length > 0);
}

export function listEnabledCreatableDocumentTypes(
  enabledPluginIds: ReadonlySet<PluginId>,
): readonly DocumentTypeContribution[] {
  return listCreatableDocumentTypes().filter((documentType) => isEnabledPlugin(documentType.pluginId, enabledPluginIds));
}

export function listCreatableDocumentTypesForLoadedRuntimeState(options: {
  readonly hasLoaded: boolean;
  readonly enabledPluginIds: ReadonlySet<PluginId>;
}): readonly DocumentTypeContribution[] {
  // 中文说明：启动期 seed 只是让 UI 能显示已注册插件摘要，不能代表真实运行态。
  // 新建入口会产生真实数据写入，必须等 SQLite 运行态加载完成后再展示插件/文档创建能力。
  if (!options.hasLoaded) return [];
  return listEnabledCreatableDocumentTypes(options.enabledPluginIds);
}

export function listToolCards(enabledPluginIds: ReadonlySet<PluginId>): Readonly<Record<string, ToolUiEntry>> {
  return Object.fromEntries(
    Array.from(toolCards.entries())
      .filter(([, contribution]) => isEnabledPlugin(contribution.pluginId, enabledPluginIds))
      .map(([name, contribution]) => [name, contribution.entry]),
  );
}

export function listConversationAgentChoices(
  enabledPluginIds: ReadonlySet<PluginId>,
): readonly ConversationAgentChoiceContribution[] {
  return Array.from(conversationAgentChoices.values())
    .filter((registration) => isEnabledPlugin(registration.pluginId, enabledPluginIds))
    .map((registration) => registration.contribution);
}

export function listAllConversationAgentChoicesForDiagnostics(): readonly ConversationAgentChoiceContribution[] {
  return Array.from(conversationAgentChoices.values()).map((registration) => registration.contribution);
}

export function getConversationAgentChoiceById(
  agentChoiceId: string,
  enabledPluginIds: ReadonlySet<PluginId>,
): ConversationAgentChoiceContribution | null {
  const registration = conversationAgentChoices.get(agentChoiceId);
  if (!registration || !isEnabledPlugin(registration.pluginId, enabledPluginIds)) {
    return null;
  }
  return registration.contribution;
}

export function getDocumentActionMenuByActiveType(
  activeDocumentType: string,
  enabledPluginIds: ReadonlySet<PluginId>,
): DocumentActionMenuContribution | null {
  const registration = documentActionMenus.get(activeDocumentType);
  if (!registration || !isEnabledPlugin(registration.pluginId, enabledPluginIds)) {
    return null;
  }
  return registration.contribution;
}

export function getDocumentRuntimeLoaderByActiveType(
  activeDocumentType: string,
  enabledPluginIds: ReadonlySet<PluginId>,
): DocumentRuntimeLoaderContribution | null {
  const registration = documentRuntimeLoaders.get(activeDocumentType);
  if (!registration || !isEnabledPlugin(registration.pluginId, enabledPluginIds)) {
    return null;
  }
  return registration.contribution;
}

export function clearRendererPluginRegistryForTest(): void {
  for (const contribution of rendererPluginContributions.values()) {
    if (contribution.conversationInput) {
      unregisterPluginConversationInputContribution(contribution.conversationInput);
    }
  }
  pluginMetas.clear();
  rendererPluginContributions.clear();
  toolCards.clear();
  documentActionMenus.clear();
  documentRuntimeLoaders.clear();
  conversationAgentChoices.clear();
  activeRendererPlugins.clear();
  clearRegisteredDocumentTypesForTest();
  bumpRendererPluginRegistryRevision();
}
