import type {
  RendererPluginContribution,
} from '@plugin/renderer/pluginContribution';
import { defineAsyncComponent, type Component } from 'vue';
import {
  SLIDES_ACTIVE_DOCUMENT_TYPE,
  SLIDES_DOCUMENT_TYPE,
  SLIDES_PLUGIN_ID,
  SLIDES_PLUGIN_META,
} from '@plugin/slides/shared/pluginMeta';
import { SLIDES_AGENT_ID } from '@plugin/slides/shared/agentIdentity';
import SlidesIcon from './icon/SlidesIcon.vue';
import { slidesDocumentRuntimeLoader } from './features/documentRuntime';
import { slidesDocumentActionMenu } from './features/presentationExport';
import {
  registerSlidesRendererPorts,
  unregisterSlidesRendererPorts,
} from './ports/registerSlidesRendererPorts';
import { presentationToolConfigs } from './tool-cards/presentation';
import sourceSelectionPromptPopoverStylesheet from './features/sourceSelection/ui/SourceSelectionPromptPopover.css?url';
import slidesDraftFailureLogStylesheet from './features/documentBuildFailure/ui/SlidesDraftFailureLog.css?url';
import slidesPageStylesheet from './page/SlidesPage.css?url';
import slidesViewStylesheet from './page/SlidesView.css?url';
import deckViewerStylesheet from './ui/deck/DeckViewer.css?url';
import deckOutlineStylesheet from './ui/deck/DeckOutline.css?url';
import slideThumbnailStylesheet from './ui/deck/SlideThumbnail.css?url';
import slideStageStylesheet from './ui/preview/SlideStage.css?url';
import slidesStatusStateStylesheet from './ui/shared/SlidesStatusState.css?url';
import presentationExportModalStylesheet from './features/presentationExport/ui/PresentationExportModal.css?url';
import templateListStylesheet from './ui/templates/TemplateList.css?url';
import presentationActionCardStylesheet from './tool-cards/styles/PresentationActionCard.css?url';
import presentationInspectCardStylesheet from './tool-cards/styles/PresentationInspectCard.css?url';
import pptPlanApprovalCardStylesheet from './tool-cards/styles/PptPlanApprovalCard.css?url';
import slidesShellStylesheet from './styles/index.css?url';

export { presentationToolConfigs } from './tool-cards/presentation';
export {
  registerSlidesRendererPorts,
  unregisterSlidesRendererPorts,
} from './ports/registerSlidesRendererPorts';

export const SLIDES_RENDERER_AVAILABLE = true;

// SlidesPage 会拉起 Konva、图表和整套文稿交互状态。contribution 入口只声明能力，
// 用户真正打开演示文稿时再加载重型 surface。
const slidesPageModules = import.meta.glob<{ default: Component }>('./page/SlidesPage.vue');
const SlidesPage = defineAsyncComponent(async () => {
  const loadSlidesPage = slidesPageModules['./page/SlidesPage.vue'];
  if (!loadSlidesPage) {
    throw new Error('[slides-renderer] SlidesPage chunk 未注册');
  }
  return (await loadSlidesPage()).default;
});

const slidesStylesheets = [
  slidesShellStylesheet,
  slidesDraftFailureLogStylesheet,
  sourceSelectionPromptPopoverStylesheet,
  slidesPageStylesheet,
  slidesViewStylesheet,
  deckViewerStylesheet,
  deckOutlineStylesheet,
  slideThumbnailStylesheet,
  slideStageStylesheet,
  slidesStatusStateStylesheet,
  presentationExportModalStylesheet,
  templateListStylesheet,
  presentationActionCardStylesheet,
  presentationInspectCardStylesheet,
  pptPlanApprovalCardStylesheet,
] as const;

export const slidesRendererPlugin: RendererPluginContribution = {
  meta: SLIDES_PLUGIN_META,
  stylesheets: slidesStylesheets,
  activate: registerSlidesRendererPorts,
  deactivate: unregisterSlidesRendererPorts,
  documentTypes: [
    {
      pluginId: SLIDES_PLUGIN_ID,
      nodeType: SLIDES_DOCUMENT_TYPE,
      activeDocumentType: SLIDES_ACTIVE_DOCUMENT_TYPE,
      createRequestType: SLIDES_DOCUMENT_TYPE,
      createBackend: 'plugin-document',
      createHandlerId: 'slides.document-create',
      surfaceComponent: SlidesPage,
      shellClass: 'for-slides',
      label: '演示文稿',
      createLabel: '新建演示文稿',
      defaultName: '未命名演示文稿',
      iconComponent: SlidesIcon,
      iconClass: 'presentation-icon',
      createPriority: 40,
      entityReferences: [
        {
          kind: 'deck',
          uriPattern: 'linnya://slides/{documentId}',
          description: 'Slides 演示文稿本体，可作为跨插件引用的根实体。',
        },
        {
          kind: 'slide',
          uriPattern: 'linnya://slides/{documentId}#slide/{slideId}',
          description: '单页幻灯片实体，用于跳转、引用和后续插件协作。',
        },
      ],
    },
  ],
  conversationAgentChoices: [
    {
      id: 'ppt',
      agentId: SLIDES_AGENT_ID,
      menuText: 'PPT',
      pillText: 'PPT',
      ariaLabel: '已开启：PPT',
      iconComponent: SlidesIcon,
    },
  ],
  toolCards: presentationToolConfigs,
  documentActionMenus: [slidesDocumentActionMenu],
  documentRuntimeLoaders: [slidesDocumentRuntimeLoader],
};

export const rendererPlugin = slidesRendererPlugin;

export default slidesRendererPlugin;
