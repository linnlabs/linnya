import { net, protocol } from 'electron';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  readDirectPluginDirsFromEnv,
  resolveInsidePluginDir,
  resolvePluginDirById,
} from './pluginLayout';
import {
  getPluginProtocolPrivilegedScheme,
  PLUGIN_PROTOCOL_SCHEME,
} from '../../protocols/definitions/privilegedSchemes';
import {
  rendererUiPluginRuntimeEntries,
} from '../../../../scripts/build/renderer-ui-runtime/rendererUiRuntimeEntryCatalog.mjs';

const pluginScheme = PLUGIN_PROTOCOL_SCHEME;
let isPluginProtocolHandlerRegistered = false;

const hostShimModules = new Map<string, string>([
  ['/vue.js', `
const host = globalThis.__LINNYA_RENDERER_PLUGIN_HOST_MODULES__?.vue;
if (!host) throw new Error('Linnya renderer plugin host Vue module is not installed.');
const missingExports = [
  'version',
  'createApp',
  'createVNode',
  'render',
  'shallowRef',
  'ref',
  'triggerRef',
  'computed',
  'watch',
  'defineComponent',
  'onMounted',
  'onBeforeUnmount',
  'onUnmounted',
  'openBlock',
  'createElementBlock',
  'createElementVNode',
  'normalizeClass',
  'normalizeStyle',
  'normalizeProps',
  'guardReactiveProps',
  'unref',
  'getCurrentScope',
  'onScopeDispose',
  'toValue',
  'reactive',
  'createBlock',
  'Teleport',
  'withModifiers',
  'createCommentVNode',
  'nextTick',
  'h',
  'getCurrentInstance',
  'watchEffect',
  'markRaw',
  'customRef',
  'withDirectives',
  'vShow',
  'Fragment',
  'renderList',
  'toDisplayString',
  'withKeys',
  'withCtx',
  'vModelText',
  'createTextVNode',
  'resolveDynamicComponent',
  'defineAsyncComponent',
  'createSlots',
  'provide',
  'inject',
  'Transition',
  'resolveComponent',
].filter((name) => host[name] === undefined);
if (missingExports.length > 0) {
  throw new Error('Linnya renderer plugin host Vue module is missing exports: ' + missingExports.join(', '));
}
export const version = host.version;
export const createApp = host.createApp;
export const createVNode = host.createVNode;
export const render = host.render;
export const shallowRef = host.shallowRef;
export const ref = host.ref;
export const triggerRef = host.triggerRef;
export const computed = host.computed;
export const watch = host.watch;
export const defineComponent = host.defineComponent;
export const onMounted = host.onMounted;
export const onBeforeUnmount = host.onBeforeUnmount;
export const onUnmounted = host.onUnmounted;
export const openBlock = host.openBlock;
export const createElementBlock = host.createElementBlock;
export const createElementVNode = host.createElementVNode;
export const normalizeClass = host.normalizeClass;
export const normalizeStyle = host.normalizeStyle;
export const normalizeProps = host.normalizeProps;
export const guardReactiveProps = host.guardReactiveProps;
export const unref = host.unref;
export const getCurrentScope = host.getCurrentScope;
export const onScopeDispose = host.onScopeDispose;
export const toValue = host.toValue;
export const reactive = host.reactive;
export const createBlock = host.createBlock;
export const Teleport = host.Teleport;
export const withModifiers = host.withModifiers;
export const createCommentVNode = host.createCommentVNode;
export const nextTick = host.nextTick;
export const h = host.h;
export const getCurrentInstance = host.getCurrentInstance;
export const watchEffect = host.watchEffect;
export const markRaw = host.markRaw;
export const customRef = host.customRef;
export const withDirectives = host.withDirectives;
export const vShow = host.vShow;
export const Fragment = host.Fragment;
export const renderList = host.renderList;
export const toDisplayString = host.toDisplayString;
export const withKeys = host.withKeys;
export const withCtx = host.withCtx;
export const vModelText = host.vModelText;
export const createTextVNode = host.createTextVNode;
export const resolveDynamicComponent = host.resolveDynamicComponent;
export const defineAsyncComponent = host.defineAsyncComponent;
export const createSlots = host.createSlots;
export const provide = host.provide;
export const inject = host.inject;
export const Transition = host.Transition;
export const resolveComponent = host.resolveComponent;
export default host;
`],
  ['/pinia.js', `
const host = globalThis.__LINNYA_RENDERER_PLUGIN_HOST_MODULES__?.pinia;
if (!host) throw new Error('Linnya renderer plugin host Pinia module is not installed.');
export const createPinia = host.createPinia;
export const defineStore = host.defineStore;
export const setActivePinia = host.setActivePinia;
export const storeToRefs = host.storeToRefs;
export default host;
`],
]);

function buildNamedHostShim(specifier: string, exportNames: readonly string[]): string {
  const lines = [
    `const host = globalThis.__LINNYA_RENDERER_PLUGIN_HOST_MODULES__?.modules?.[${JSON.stringify(specifier)}];`,
    `if (!host) throw new Error('Linnya renderer plugin host module is not installed: ${specifier}');`,
    ...exportNames.map((name) => `export const ${name} = host.${name};`),
    'export default host;',
  ];
  return `${lines.join('\n')}\n`;
}

const rendererHostShims = new Map<string, string>([
  ['/app-localization.js', buildNamedHostShim('@app/localization', [
    'registerMessageCatalogs',
    'resolveLocalizedText',
    'resolveRegisteredMessage',
    'useLocalization',
    'useLocalizationStore',
  ])],
  ['/plugin-renderer/pluginIpcClient.js', buildNamedHostShim('@plugin/renderer/pluginIpcClient', ['invokeRendererPluginIpc'])],
  ['/plugin-renderer/pluginPushClient.js', buildNamedHostShim('@plugin/renderer/pluginPushClient', ['onRendererPluginPush'])],
  ['/plugin-renderer/aiInvocationPort.js', buildNamedHostShim('@plugin/renderer/aiInvocationPort', [
    'requireRendererAiInvocationPort',
  ])],
  ['/plugin-renderer/composerCommandPort.js', buildNamedHostShim('@plugin/renderer/composerCommandPort', [
    'addComposerReference',
    'removeComposerReference',
  ])],
  ['/plugin-renderer/conversationSubrunInvocationPort.js', buildNamedHostShim('@plugin/renderer/conversationSubrunInvocationPort', [
    'startConversationSubruns',
  ])],
  ['/plugin-renderer/refId.js', buildNamedHostShim('@plugin/renderer/refId', ['generateRefMap', 'normalizeRef', 'isValidRef'])],
  ['/plugin-renderer/referenceRuntime.js', buildNamedHostShim('@plugin/renderer/referenceRuntime', [
    'searchInMultipleKbs',
    'useWebManualCitationForm',
    'validateWebManualForm',
    'listKnowledgeBasesForPlugin',
  ])],
  ['/plugin-renderer/workspaceRuntime.js', buildNamedHostShim('@plugin/renderer/workspaceRuntime', [
    'getCurrentWorkspaceProjectId',
    'listProjectKnowledgeBaseIds',
    'isActiveFileDirty',
    'showWorkspaceNotification',
    'setActiveFileSaving',
    'setActiveFileDirty',
    'setActiveFileLoading',
    'confirmWorkspaceAction',
    'throwIfFileSessionOpenCancelled',
    'notifyWorkspaceDocumentOpened',
    'readWorkspaceDocument',
    'saveWorkspaceDocument',
    'createWorkspaceDocument',
    'isFileSessionOpenCancelledError',
    'getActiveFileSession',
    'markActiveFileDirty',
  ])],
  ['/plugin-renderer/subrunToolUi.js', buildNamedHostShim('@plugin/renderer/subrunToolUi', ['SubrunCard'])],
  ['/plugin-renderer/pageContextProvider.js', buildNamedHostShim('@plugin/renderer/pageContextProvider', [
    'registerRendererPageContextProvider',
    'unregisterRendererPageContextProvider',
  ])],
  ['/plugin-renderer/toolRefreshPort.js', buildNamedHostShim('@plugin/renderer/toolRefreshPort', [
    'registerRendererToolRefreshHandler',
    'unregisterRendererToolRefreshHandler',
  ])],
  ['/plugin-renderer/documentMutationPort.js', buildNamedHostShim('@plugin/renderer/documentMutationPort', [
    'registerRendererDocumentMutationHandler',
    'unregisterRendererDocumentMutationHandler',
  ])],
  ['/plugin-renderer/structuredContextRequirementPort.js', buildNamedHostShim('@plugin/renderer/structuredContextRequirementPort', [
    'registerRendererStructuredContextRequirement',
    'unregisterRendererStructuredContextRequirement',
  ])],
  ['/plugin-renderer/documentReferenceRuntimePort.js', buildNamedHostShim('@plugin/renderer/documentReferenceRuntimePort', [
    'registerDocumentReferenceRuntimeHandler',
    'unregisterDocumentReferenceRuntimeHandler',
    'listDocumentReferenceRuntimeHandlers',
  ])],
  ['/plugin-renderer/exportArtifact.js', buildNamedHostShim('@plugin/renderer/exportArtifact', [
    'requestExportArtifactTarget',
  ])],
  ['/plugin-renderer/pluginDocumentCreationPort.js', buildNamedHostShim('@plugin/renderer/pluginDocumentCreationPort', [
    'registerPluginDocumentCreationHandler',
    'unregisterPluginDocumentCreationHandler',
  ])],
  ['/plugin-renderer/referenceLinkUi.js', buildNamedHostShim('@plugin/renderer/referenceLinkUi', ['WorkspaceRefLink'])],
  ['/plugin-renderer/settingsContribution.js', buildNamedHostShim('@plugin/renderer/settingsContribution', [
    'clearSettingsContributionsForTest',
    'listSettingsContributions',
    'registerSettingsContribution',
    'unregisterSettingsContribution',
  ])],
  ['/plugin-renderer/imageAssetSource.js', buildNamedHostShim('@plugin/renderer/imageAssetSource', [
    'canLoadRendererLocalImageAsDataUrl',
    'canStatRendererLocalImage',
    'loadRendererLocalImageAsDataUrl',
    'statRendererLocalImage',
  ])],
  ['/plugin-renderer/textMeasurement.js', buildNamedHostShim('@plugin/renderer/textMeasurement', [
    'getRendererTextMeasureService',
    'resolveRendererFont',
    'resolveRendererFontFamily',
  ])],
  ['/plugin-renderer/workspaceNavigation.js', buildNamedHostShim('@plugin/renderer/workspaceNavigation', [
    'getWorkspaceNavigationPort',
  ])],
  ['/plugin-renderer/interactiveTool.js', buildNamedHostShim('@plugin/renderer/interactiveTool', [
    'concludeInteractiveToolInteraction',
  ])],
]);

const rendererUiHostShims = new Map<string, string>(
  rendererUiPluginRuntimeEntries.map((entry) => {
    if (!entry.protocolUrl || !entry.hostModuleKey) {
      throw new Error(`Renderer UI runtime entry 缺少 Host 部署字段: ${entry.specifier}`);
    }
    return [
      new URL(entry.protocolUrl).pathname,
      buildNamedHostShim(entry.hostModuleKey, entry.namedExports),
    ];
  }),
);

function normalizeHostShimPath(pathname: string): string {
  if (pathname.startsWith('/host/')) {
    return pathname.slice('/host'.length);
  }
  return pathname;
}

function resolvePluginDir(pluginId: string): string | null {
  return resolvePluginDirById({
    pluginId,
    pluginRoot: process.env.LINNYA_PLUGIN_ROOT,
    directPluginDirs: readDirectPluginDirsFromEnv(),
  });
}

function javascriptResponse(source: string): Response {
  return new Response(source, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
    },
  });
}

export function registerPluginProtocolSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([getPluginProtocolPrivilegedScheme()]);
}

export function registerPluginProtocolHandler(): void {
  if (isPluginProtocolHandlerRegistered) {
    return;
  }
  isPluginProtocolHandlerRegistered = true;

  protocol.handle(pluginScheme, (request) => {
    const url = new URL(request.url);
    if (url.hostname === 'host') {
      const hostShimPath = normalizeHostShimPath(url.pathname);
      const shim = hostShimModules.get(hostShimPath)
        ?? rendererHostShims.get(hostShimPath)
        ?? rendererUiHostShims.get(hostShimPath);
      if (shim) {
        return javascriptResponse(shim);
      }
    }

    const pluginDir = resolvePluginDir(url.hostname);
    if (!pluginDir) {
      return new Response(`Unknown plugin: ${url.hostname}`, { status: 404 });
    }

    const filePath = resolveInsidePluginDir(pluginDir, `.${decodeURIComponent(url.pathname)}`, 'plugin:// path');
    if (!fs.existsSync(filePath)) {
      return new Response(`Plugin file not found: ${url.pathname}`, { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}
