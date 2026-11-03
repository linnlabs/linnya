import { defineAsyncComponent, type Component } from 'vue';
import type { RendererPluginContribution } from '@plugin/renderer/pluginContribution';
import { registerAppearanceSection, unregisterAppearanceSection } from '@plugin/renderer/settingsContribution';
import { DocumentTextIcon } from '@linnya/renderer-ui/icons';
import { canvasPluginMeta, CANVAS_PLUGIN_ID, CANVAS_DOCUMENT_TYPE } from '@plugin/canvas/shared';
import { canvasFileHandler, readCanvasHistorySession } from './features/canvasDocument';
import { createCanvasSelectionReferenceKind, clearCanvasReferenceFocus } from './features/conversationSelection';
import { createCanvasSelectionReferencePort } from './adapters/createCanvasSelectionReferencePort';
import { persistCanvasPreferences, CanvasAppearanceSection } from './features/materialSetting';
import canvasStyles from './styles/canvas.css?url';
import markdownStyles from '@linnya/markdown-document-core/style.css?url';
import cardInkStyles from './features/cardRendering/styles/canvasCardInk.css?url';
import { clearCanvasDisplayImageCache } from './features/cardRendering/content';

let stopPreferences: (() => void) | null = null;
const modules = import.meta.glob<{ default: Component }>('./page/CanvasView.vue');
const CanvasView = defineAsyncComponent(async () => {
  const load = modules['./page/CanvasView.vue'];
  if (!load) throw new Error('Canvas surface chunk is not registered');
  return (await load()).default;
});
export const rendererPlugin: RendererPluginContribution = {
  meta: canvasPluginMeta,
  stylesheets: [markdownStyles, canvasStyles, cardInkStyles],
  conversationInput: { referenceKinds: [createCanvasSelectionReferenceKind(createCanvasSelectionReferencePort())], referenceProviders: [] },
  activate() {
    stopPreferences = persistCanvasPreferences();
    registerAppearanceSection({ pluginId: CANVAS_PLUGIN_ID, id: 'material', title: '画布', order: 10, component: CanvasAppearanceSection });
  },
  deactivate() { clearCanvasReferenceFocus(); clearCanvasDisplayImageCache(); stopPreferences?.(); stopPreferences = null; unregisterAppearanceSection(CANVAS_PLUGIN_ID, 'material'); },
  documentTypes: [{ pluginId: CANVAS_PLUGIN_ID, nodeType: CANVAS_DOCUMENT_TYPE, activeDocumentType: CANVAS_DOCUMENT_TYPE,
    fileSessionType: CANVAS_DOCUMENT_TYPE, createRequestType: CANVAS_DOCUMENT_TYPE, createBackend: 'workspace-document',
    surfaceComponent: CanvasView, historyPreviewComponent: defineAsyncComponent(() => import('./page/CanvasHistoryView.vue')), historyClientSessionId: readCanvasHistorySession, deferSurfaceUntilOpen: true, fileHandler: canvasFileHandler, shellClass: 'for-canvas', label: '画布', createLabel: '新建画布', defaultName: '未命名画布',
    iconComponent: DocumentTextIcon, iconClass: 'canvas-icon', createPriority: 25,
    entityReferences: [{ kind: 'document', uriPattern: 'linnya://canvas/{documentId}', description: '自由画布文档' }],
  }],
};
