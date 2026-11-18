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

// 源码 Vite 会提供完整 Vue；磁盘产物只拿此白名单，检查与 ESM 导出必须来自同一份名单。
const vueHostExportNames = [
  'version',
  'createApp',
  'createVNode',
  'createStaticVNode',
  'render',
  'shallowRef',
  'shallowReadonly',
  'ref',
  'isRef',
  'triggerRef',
  'computed',
  'watch',
  'watchPostEffect',
  'toRef',
  'useId',
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
  'effectScope',
  'onScopeDispose',
  'toValue',
  'reactive',
  'readonly',
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
  'renderSlot',
  'mergeProps',
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
  'resolveDirective',
] as const;

const hostShimModules = new Map<string, string>([
  ['/vue.js', `
const host = globalThis.__LINNYA_RENDERER_PLUGIN_HOST_MODULES__?.vue;
if (!host) throw new Error('Linnya renderer plugin host Vue module is not installed.');
const missingExports = ${JSON.stringify(vueHostExportNames)}.filter((name) => host[name] === undefined);
if (missingExports.length > 0) {
  throw new Error('Linnya renderer plugin host Vue module is missing exports: ' + missingExports.join(', '));
}
${vueHostExportNames.map((name) => `export const ${name} = host.${name};`).join('\n')}
export default host;
`],
  ['/pinia.js', `
const host = globalThis.__LINNYA_RENDERER_PLUGIN_HOST_MODULES__?.pinia;
if (!host) throw new Error('Linnya renderer plugin host Pinia module is not installed.');
export const createPinia = host.createPinia;
export const defineStore = host.defineStore;
export const getActivePinia = host.getActivePinia;
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
    'formatStorageBytes',
  ])],
  ['/plugin-renderer/pluginIpcClient.js', buildNamedHostShim('@plugin/renderer/pluginIpcClient', ['invokeRendererPluginIpc'])],
  ['/plugin-renderer/pluginPushClient.js', buildNamedHostShim('@plugin/renderer/pluginPushClient', ['onRendererPluginPush'])],
  ['/plugin-renderer/pluginMultipartUpload.js', buildNamedHostShim('@plugin/renderer/pluginMultipartUpload', ['uploadRendererPluginMultipart'])],
  ['/plugin-renderer/modelConfiguration.js', buildNamedHostShim('@plugin/renderer/modelConfiguration', [
    'readPurposeModelId', 'readAuxiliaryModelId', 'readModelDisplayName',
    'subscribeModelConfigurationChanges', 'openModelConfiguration', 'registerEmbeddingIndexChangeImpactPort',
  ])],
  ['/plugin-renderer/aiInvocationPort.js', buildNamedHostShim('@plugin/renderer/aiInvocationPort', [
    'requireRendererAiInvocationPort',
  ])],
  ['/plugin-renderer/composerCommandPort.js', buildNamedHostShim('@plugin/renderer/composerCommandPort', [
    'addComposerReference',
    'removeComposerReference',
    'focusComposerInput',
  ])],
  ['/plugin-renderer/conversationSubrunInvocationPort.js', buildNamedHostShim('@plugin/renderer/conversationSubrunInvocationPort', [
    'startConversationSubruns',
  ])],
  ['/plugin-renderer/refId.js', buildNamedHostShim('@plugin/renderer/refId', ['generateRefMap', 'normalizeRef', 'isValidRef'])],
  ['/plugin-renderer/documentReferences.js', buildNamedHostShim('@plugin/renderer/documentReferences', ['queryDocumentReferences', 'readDocumentReference', 'readDocumentBacklinks', 'previewDocumentDeletionReferences'])],
  ['/plugin-renderer/pluginRuntime.js', buildNamedHostShim('@plugin/renderer/pluginRuntime', ['readRendererPluginAvailability', 'subscribeRendererPluginAvailability'])],
  ['/plugin-renderer/documentPreview.js', buildNamedHostShim('@plugin/renderer/documentPreview', ['readDocumentPreview', 'listDocumentPreviewTypes', 'readDocumentPreviewTypeIcon', 'mountDocumentPreview'])],
  ['/plugin-renderer/workspaceRuntime.js', buildNamedHostShim('@plugin/renderer/workspaceRuntime', [
    'getCurrentWorkspaceProjectId',
    'subscribeWorkspaceMutations',
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
  ['/plugin-renderer/executionPresentation.js', buildNamedHostShim('@plugin/renderer/executionPresentation', ['ToolActivityIndicator'])],
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
  ['/plugin-renderer/embeddedMarkdownEditor.js', buildNamedHostShim('@plugin/renderer/embeddedMarkdownEditor', ['createEmbeddedMarkdownEditor', 'parseEmbeddedMarkdown', 'serializeEmbeddedMarkdown'])],
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
    'clearAppearanceSectionsForTest',
    'listAppearanceSections',
    'registerAppearanceSection',
    'unregisterAppearanceSection',
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
