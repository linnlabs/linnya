export {
  createRenderVirtualizationEngine,
  RENDER_VIRTUALIZATION_ENGINE_KEY,
} from './controller/renderVirtualizationEngine'
export type {
  CreateRenderVirtualizationEngineOptions,
  RenderVirtualizationEngine,
  RenderVirtualizationEngineEditor,
  RenderVirtualizationEngineSnapshot,
} from './controller/renderVirtualizationEngine'
export type {
  RenderVirtualizationRefreshReason,
  RenderVirtualizationRefreshReasonInput,
} from './controller/refreshReason'
export {
  hydrateRootBlockForInteraction,
  positionCursorAtBlockEndWithHandshake,
  positionTextSelectionWithHandshake,
  scrollEditorToBlock,
} from './controller/scrollHandshake'
export type {
  ScrollHandshakeEditor,
  ScrollHandshakeEditorView,
  ScrollToBlockOptions,
  ScrollToBlockResult,
} from './controller/scrollHandshake'
export {
  hydrateKeyboardTargetRootBlock,
} from './controller/keyboardPreHydration'
export type {
  KeyboardPreHydrationEditorView,
} from './controller/keyboardPreHydration'
export {
  createPlaceholderShellView,
} from './view/PlaceholderShellView'
export {
  createRootBlockDomNodeView,
} from './view/RootBlockDomNodeView'
export type {
  RootBlockDomNodeViewOptions,
} from './view/RootBlockDomNodeView'
export { DEFAULT_PLACEHOLDER_ROOT_BLOCK_HEIGHT } from './renderVirtualizationConstants'
export {
  DEFAULT_VIRTUAL_ROOT_BLOCK_THRESHOLD,
  shouldEnableVirtualRootBlockRendering,
} from './policy/shouldEnableVirtualization'
export type {
  VirtualizationPolicyDecision,
  VirtualizationPolicyInput,
} from './policy/shouldEnableVirtualization'
export type {
  RenderVirtualizationOwner,
} from './definitions/renderVirtualizationOwner'
export { BlockHeightCache } from './state/blockHeightCache'
export type {
  BlockHeightCacheOptions,
  BlockHeightCacheSnapshot,
} from './state/blockHeightCache'
export {
  getRenderVirtualizationBlockHeight,
  getRenderVirtualizationBlockLayoutHeight,
  getRenderVirtualizationBlockHeightCacheSnapshot,
  recordRenderVirtualizationBlockHeight,
  resetRenderVirtualizationBlockHeightCache,
} from './state/blockHeightCacheRegistry'
export {
  KeepAliveRegistry,
} from './state/keepAliveRegistry'
export type {
  KeepAliveRegistryOptions,
  KeepAliveRegistryDebugSnapshot,
  KeepAliveRegistryBlockSnapshot,
  RenderVirtualizationKeepAliveReason,
} from './state/keepAliveRegistry'
export {
  RENDER_VIRTUALIZATION_KEEP_ALIVE_PORT_KEY,
  createRegistryKeepAlivePort,
} from './state/keepAlivePort'
export type {
  RenderVirtualizationKeepAliveCommand,
  RenderVirtualizationKeepAlivePort,
} from './state/keepAlivePort'
export {
  RENDER_VIRTUALIZATION_KEEP_ALIVE_EVENT,
  dispatchRenderVirtualizationKeepAlive,
} from './state/keepAliveEvents'
export type {
  RenderVirtualizationKeepAliveEvent,
  RenderVirtualizationKeepAliveEventDetail,
} from './state/keepAliveEvents'
export {
  dispatchNodeViewRenderVirtualizationKeepAlive,
  findRootBlockIdForNodeView,
} from './state/nodeViewKeepAlive'
export {
  dispatchPositionRenderVirtualizationKeepAlive,
  findRootBlockIdAtDocumentPosition,
} from './state/positionKeepAlive'
export {
  awaitHydratedRootBlockNodeView,
  getRootBlockNodeViewLifecycleDebugSnapshot,
  getRootBlockNodeViewLifecycleEntries,
  getRootBlockNodeViewLifecycleEntry,
  publishRootBlockNodeViewMounted,
  publishRootBlockNodeViewUnmounted,
  resetRootBlockNodeViewLifecycleRegistry,
  subscribeRootBlockNodeViewLifecycle,
} from './state/nodeViewLifecycle'
export type {
  RootBlockNodeViewLifecycleEntry,
  RootBlockNodeViewLifecycleEvent,
  RootBlockNodeViewLifecycleEventType,
} from './state/nodeViewLifecycle'
export {
  useRenderVirtualizationKeepAliveLease,
} from './state/useRenderVirtualizationKeepAliveLease'
export {
  RootBlockRuntimeRegistry,
  getRootBlockRuntimeRegistry,
  registerRootBlockRuntimeHandle,
  resetRootBlockRuntimeRegistry,
} from './runtime/RootBlockRuntimeRegistry'
export type {
  RootBlockRuntimeHandle,
  RootBlockRuntimeRegistryDebugSnapshot,
  RootBlockRuntimeRegistryEvent,
  RootBlockRuntimeRegistryEventType,
  RootBlockRuntimeRegistryOwner,
} from './runtime/RootBlockRuntimeRegistry'
export {
  RENDER_VIRTUALIZATION_META_KEY,
  DEFAULT_INITIAL_HYDRATED_ROOT_BLOCK_COUNT,
  createRenderVirtualizationPlugin,
  getRenderVirtualizationState,
  isRootBlockHydratedByVirtualizationState,
  findSelectionRootBlockId,
  prepareInitialRenderVirtualizationState,
  renderVirtualizationPluginKey,
} from './state/renderVirtualizationPlugin'
export type {
  PrepareInitialRenderVirtualizationOptions,
  RenderVirtualizationMeta,
  RenderVirtualizationState,
} from './state/renderVirtualizationPlugin'
export { RenderVirtualizationExtension } from './RenderVirtualizationExtension'
export {
  ROOT_BLOCK_RENDER_MODE_DATA_ATTR,
  ROOT_BLOCK_RENDER_MODE_SPEC_KEY,
  isPlaceholderRootBlockRenderMode,
  readExplicitRootBlockRenderModeFromDecorations,
  readRootBlockRenderModeFromDecorations,
} from './view/rootBlockRenderMode'
export type { RootBlockRenderMode } from './view/rootBlockRenderMode'
export { resolveRootBlockRenderMode } from './view/resolveRootBlockRenderMode'
export type { ResolveRootBlockRenderModeInput } from './view/resolveRootBlockRenderMode'
