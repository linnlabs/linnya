import { defineAsyncComponent } from 'vue';
import { LibraryIcon } from '@linnya/renderer-ui/icons';
import type { RendererPluginContribution } from '../types';
import { knowledgeDocumentActions } from './knowledge/orchestration/knowledgeDocumentActions';

/** 仅产品组合根引入此对象并授予固定应用槽；磁盘插件的 builtin 声明不建立信任。 */
export const knowledgeRendererPlugin: RendererPluginContribution = {
  meta: { id: 'knowledge', name: 'Knowledge Base', version: '1.0.0',
    description: 'Knowledge library and project associations', developer: 'Linnya', builtin: true, required: false },
  applicationSurface: {
    title: { key: 'layout.header.knowledgeBase', fallback: 'Knowledge Base' },
    iconComponent: LibraryIcon,
    pageComponent: defineAsyncComponent(() => import('@/domains/knowledgebase/ui/page/KnowledgeBaseView.vue')),
    projectAssociationComponent: defineAsyncComponent(() => import('./knowledge/KnowledgeProjectAssociation.vue')),
    projectCreationComponent: defineAsyncComponent(() => import('./knowledge/KnowledgeProjectCreation.vue')),
    globalModalComponent: defineAsyncComponent(() => import('./knowledge/KnowledgeGlobalModals.vue')),
    async prepare(signal) {
      const { prepareKnowledgePage } = await import('@/domains/knowledgebase/applicationSurface');
      signal.throwIfAborted();
      await prepareKnowledgePage(signal);
    },
    async openSource(target, signal) {
      const { openKnowledgeSource } = await import('@/domains/knowledgebase/applicationSurface');
      signal.throwIfAborted();
      await openKnowledgeSource(target, signal);
    },
  },
  documentActionMenus: [knowledgeDocumentActions.menu],
  deactivate: () => knowledgeDocumentActions.cancel(),
};
