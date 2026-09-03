import * as pinia from 'pinia';
import * as vue from 'vue';

import * as rendererUi from '@linnya/renderer-ui';
import * as rendererUiIcons from '@linnya/renderer-ui/icons';
import * as rendererUiLocalization from '@linnya/renderer-ui/localization';
import * as rendererUiScroll from '@linnya/renderer-ui/scroll';
import * as rendererUiTheme from '@linnya/renderer-ui/theme';
import * as rendererUiVersion from '@linnya/renderer-ui/version';
import {
  rendererUiPluginRuntimeEntries,
} from '../../../../../scripts/build/renderer-ui-runtime/rendererUiRuntimeEntryCatalog.mjs';

import * as appLocalization from '@app/localization';
import * as aiInvocationPort from '@plugin/renderer/aiInvocationPort';
import * as composerCommandPort from '@plugin/renderer/composerCommandPort';
import * as conversationSubrunInvocationPort from '@plugin/renderer/conversationSubrunInvocationPort';
import * as documentMutationPort from '@plugin/renderer/documentMutationPort';
import * as documentReferenceRuntimePort from '@plugin/renderer/documentReferenceRuntimePort';
import * as exportArtifact from '@plugin/renderer/exportArtifact';
import * as imageAssetSource from '@plugin/renderer/imageAssetSource';
import * as interactiveTool from '@plugin/renderer/interactiveTool';
import * as pageContextProvider from '@plugin/renderer/pageContextProvider';
import * as pluginDocumentCreationPort from '@plugin/renderer/pluginDocumentCreationPort';
import * as pluginIpcClient from '@plugin/renderer/pluginIpcClient';
import * as pluginPushClient from '@plugin/renderer/pluginPushClient';
import * as refId from '@plugin/renderer/refId';
import * as referenceLinkUi from '@plugin/renderer/referenceLinkUi';
import * as referenceRuntime from '@plugin/renderer/referenceRuntime';
import * as settingsContribution from '@plugin/renderer/settingsContribution';
import * as subrunToolUi from '@plugin/renderer/subrunToolUi';
import * as textMeasurement from '@plugin/renderer/textMeasurement';
import * as structuredContextRequirementPort from '@plugin/renderer/structuredContextRequirementPort';
import * as toolRefreshPort from '@plugin/renderer/toolRefreshPort';
import * as workspaceNavigation from '@plugin/renderer/workspaceNavigation';
import * as workspaceRuntime from '@plugin/renderer/workspaceRuntime';

const hostModuleGlobalKey = '__LINNYA_RENDERER_PLUGIN_HOST_MODULES__';

interface RendererPluginHostModules {
  readonly vue: typeof vue;
  readonly pinia: typeof pinia;
  readonly modules: Readonly<Record<string, unknown>>;
}

declare global {
  interface Window {
    __LINNYA_RENDERER_PLUGIN_HOST_MODULES__?: RendererPluginHostModules;
  }
}

const rendererUiModulesByEntryId = Object.freeze({
  root: rendererUi,
  icons: rendererUiIcons,
  localization: rendererUiLocalization,
  scroll: rendererUiScroll,
  theme: rendererUiTheme,
  version: rendererUiVersion,
});

function createRendererUiHostModules(): Readonly<Record<string, unknown>> {
  return Object.fromEntries(rendererUiPluginRuntimeEntries.map((entry) => {
    if (!entry.id || !entry.hostModuleKey) {
      throw new Error(`Renderer UI runtime entry 缺少 provider 字段: ${entry.specifier}`);
    }
    return [entry.hostModuleKey, rendererUiModulesByEntryId[entry.id]];
  }));
}

export function installRendererPluginHostModules(): void {
  const modules: RendererPluginHostModules = {
    vue,
    pinia,
    modules: {
      '@app/localization': appLocalization,
      '@plugin/renderer/aiInvocationPort': aiInvocationPort,
      '@plugin/renderer/composerCommandPort': composerCommandPort,
      '@plugin/renderer/conversationSubrunInvocationPort': conversationSubrunInvocationPort,
      '@plugin/renderer/documentMutationPort': documentMutationPort,
      '@plugin/renderer/documentReferenceRuntimePort': documentReferenceRuntimePort,
      '@plugin/renderer/exportArtifact': exportArtifact,
      '@plugin/renderer/imageAssetSource': imageAssetSource,
      '@plugin/renderer/interactiveTool': interactiveTool,
      '@plugin/renderer/pageContextProvider': pageContextProvider,
      '@plugin/renderer/pluginDocumentCreationPort': pluginDocumentCreationPort,
      '@plugin/renderer/pluginIpcClient': pluginIpcClient,
      '@plugin/renderer/pluginPushClient': pluginPushClient,
      '@plugin/renderer/refId': refId,
      '@plugin/renderer/referenceLinkUi': referenceLinkUi,
      '@plugin/renderer/referenceRuntime': referenceRuntime,
      '@plugin/renderer/settingsContribution': settingsContribution,
      '@plugin/renderer/subrunToolUi': subrunToolUi,
      '@plugin/renderer/textMeasurement': textMeasurement,
      '@plugin/renderer/structuredContextRequirementPort': structuredContextRequirementPort,
      '@plugin/renderer/toolRefreshPort': toolRefreshPort,
      '@plugin/renderer/workspaceNavigation': workspaceNavigation,
      '@plugin/renderer/workspaceRuntime': workspaceRuntime,
      ...createRendererUiHostModules(),
    },
  };

  window[hostModuleGlobalKey] = modules;
}
