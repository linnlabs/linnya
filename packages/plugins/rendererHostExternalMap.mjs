import {
  rendererUiPluginRuntimeEntries,
} from '../../scripts/build/renderer-ui-runtime/rendererUiRuntimeEntryCatalog.mjs';

const rendererUiExternalUrls = Object.fromEntries(
  rendererUiPluginRuntimeEntries.map(entry => [entry.specifier, entry.protocolUrl]),
);

export const hostRendererExternalUrls = Object.freeze({
  vue: 'plugin://host/vue.js',
  pinia: 'plugin://host/pinia.js',
  '@app/localization': 'plugin://host/app-localization.js',
  '@plugin/renderer/aiInvocationPort': 'plugin://host/plugin-renderer/aiInvocationPort.js',
  '@plugin/renderer/composerCommandPort': 'plugin://host/plugin-renderer/composerCommandPort.js',
  '@plugin/renderer/conversationSubrunInvocationPort': 'plugin://host/plugin-renderer/conversationSubrunInvocationPort.js',
  '@plugin/renderer/documentMutationPort': 'plugin://host/plugin-renderer/documentMutationPort.js',
  '@plugin/renderer/documentReferenceRuntimePort': 'plugin://host/plugin-renderer/documentReferenceRuntimePort.js',
  '@plugin/renderer/exportArtifact': 'plugin://host/plugin-renderer/exportArtifact.js',
  '@plugin/renderer/imageAssetSource': 'plugin://host/plugin-renderer/imageAssetSource.js',
  '@plugin/renderer/interactiveTool': 'plugin://host/plugin-renderer/interactiveTool.js',
  '@plugin/renderer/pageContextProvider': 'plugin://host/plugin-renderer/pageContextProvider.js',
  '@plugin/renderer/pluginDocumentCreationPort': 'plugin://host/plugin-renderer/pluginDocumentCreationPort.js',
  '@plugin/renderer/pluginIpcClient': 'plugin://host/plugin-renderer/pluginIpcClient.js',
  '@plugin/renderer/pluginPushClient': 'plugin://host/plugin-renderer/pluginPushClient.js',
  '@plugin/renderer/refId': 'plugin://host/plugin-renderer/refId.js',
  '@plugin/renderer/referenceLinkUi': 'plugin://host/plugin-renderer/referenceLinkUi.js',
  '@plugin/renderer/referenceRuntime': 'plugin://host/plugin-renderer/referenceRuntime.js',
  '@plugin/renderer/settingsContribution': 'plugin://host/plugin-renderer/settingsContribution.js',
  '@plugin/renderer/subrunToolUi': 'plugin://host/plugin-renderer/subrunToolUi.js',
  '@plugin/renderer/textMeasurement': 'plugin://host/plugin-renderer/textMeasurement.js',
  '@plugin/renderer/structuredContextRequirementPort': 'plugin://host/plugin-renderer/structuredContextRequirementPort.js',
  '@plugin/renderer/toolRefreshPort': 'plugin://host/plugin-renderer/toolRefreshPort.js',
  '@plugin/renderer/workspaceNavigation': 'plugin://host/plugin-renderer/workspaceNavigation.js',
  '@plugin/renderer/workspaceRuntime': 'plugin://host/plugin-renderer/workspaceRuntime.js',
  ...rendererUiExternalUrls,
});

export function isHostRendererExternal(id) {
  return Object.prototype.hasOwnProperty.call(hostRendererExternalUrls, id);
}

export function resolveHostRendererExternalUrl(id) {
  return hostRendererExternalUrls[id] ?? id;
}
