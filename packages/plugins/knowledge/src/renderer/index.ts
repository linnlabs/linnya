import { knowledgePluginMeta } from '../shared';
import { defineAsyncComponent } from 'vue';
import { LibraryIcon } from '@linnya/renderer-ui/icons';
import type { RendererPluginContribution } from '@plugin/renderer/pluginContribution';
import knowledgeStylesheet from './styles/index.css?url';
import { knowledgeDocumentActions } from './application/orchestration/knowledgeDocumentActions';
import { ensureKnowledgeBaseLocalizationRegistered } from './orchestration/ensureKnowledgeBaseLocalizationRegistered';
import { registerKnowledgeBaseModelConfigurationPorts } from './registrations/registerModelConfigurationPorts';
import { disposeKnowledgeBaseRuntime, useKnowledgeBase } from './runtime.js';
import { disposeKnowledgeGraphProgress } from './features/graph-progress/runtime';
import { startKnowledgeRequestSession, stopKnowledgeRequestSession } from './services/knowledgeRequestSession';

let releaseModelImpact: (() => void) | null = null;

function deactivate(): void {
  knowledgeDocumentActions.cancel();
  stopKnowledgeRequestSession();
  disposeKnowledgeBaseRuntime();
  disposeKnowledgeGraphProgress();
  releaseModelImpact?.();
  releaseModelImpact = null;
}

/** 应用槽由产品组合根授信；贡献只拥有自己的页面、命令与启停资源。 */
export const knowledgeRendererPlugin: RendererPluginContribution = {
  meta: knowledgePluginMeta,
  stylesheets: [knowledgeStylesheet],
  activate() {
    ensureKnowledgeBaseLocalizationRegistered();
    startKnowledgeRequestSession();
    try {
      useKnowledgeBase();
      releaseModelImpact = registerKnowledgeBaseModelConfigurationPorts();
    } catch (error) {
      deactivate();
      throw error;
    }
  },
  deactivate,
  applicationSurface: {
    title: { key: 'knowledgeBase.list.title', fallback: 'Knowledge Base' },
    iconComponent: LibraryIcon,
    pageComponent: defineAsyncComponent(() => import('./ui/page/KnowledgeBaseView.vue')),
    projectAssociationComponent: defineAsyncComponent(() => import('./application/KnowledgeProjectAssociation.vue')),
    projectCreationComponent: defineAsyncComponent(() => import('./application/KnowledgeProjectCreation.vue')),
    globalModalComponent: defineAsyncComponent(() => import('./application/KnowledgeGlobalModals.vue')),
    async prepare(signal) {
      const { prepareKnowledgePage } = await import('./applicationSurface');
      signal.throwIfAborted();
      await prepareKnowledgePage(signal);
    },
    async openSource(target, signal) {
      const { openKnowledgeSource } = await import('./applicationSurface');
      signal.throwIfAborted();
      await openKnowledgeSource(target, signal);
    },
  },
  documentActionMenus: [knowledgeDocumentActions.menu],
};

export default knowledgeRendererPlugin;
