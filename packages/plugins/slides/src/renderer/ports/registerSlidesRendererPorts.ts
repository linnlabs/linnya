/**
 * @file registerSlidesRendererPorts.ts
 * @description 注册 Slides 渲染端对 host 暴露的窄能力。
 *
 * 中文说明：
 * - 这里是阶段 2 的 renderer 逻辑插件边界；
 * - conversation / workspace 只通过 SDK port 调用，不再直接 import slides domain；
 * - 注册函数依赖各 port 自身的幂等逻辑，适配 HMR 和测试重复加载。
 */

import {
  registerDocumentReferenceRuntimeHandler,
  unregisterDocumentReferenceRuntimeHandler,
  type DocumentReferenceFocusResult,
} from '@plugin/renderer/documentReferenceRuntimePort';
import {
  registerRendererDocumentMutationHandler,
  unregisterRendererDocumentMutationHandler,
} from '@plugin/renderer/documentMutationPort';
import {
  registerRendererPageContextProvider,
  unregisterRendererPageContextProvider,
} from '@plugin/renderer/pageContextProvider';
import {
  registerRendererStructuredContextRequirement,
  unregisterRendererStructuredContextRequirement,
} from '@plugin/renderer/structuredContextRequirementPort';
import {
  registerPluginDocumentCreationHandler,
  unregisterPluginDocumentCreationHandler,
} from '@plugin/renderer/pluginDocumentCreationPort';
import { createWorkspaceDocument } from '@plugin/renderer/workspaceRuntime';
import {
  SLIDES_ACTIVE_DOCUMENT_TYPE,
  SLIDES_DOCUMENT_TYPE,
} from '@plugin/slides/shared/pluginMeta';
import {
  buildSlidesDocumentContextFragment,
  buildSlidesPageContextDocument,
  buildSlidesPageContextSelection,
  buildSlidesPageContextSummary,
} from '../features/pageContext';
import type { SlidesDeckPageContextInput } from '../features/pageContext';
import { useSlidesStore } from '../store/slidesStore';
import { useSlidesUiStore } from '../store/slidesUiStore';
import { useSlidesSourceSelectionStore } from '../features/sourceSelection';
import {
  listSlidesReferenceIds,
  resolveSlidesReferenceFocusTarget,
} from '../features/documentReference';
import { clearRenderableImageSourceCache } from '../services/renderAssetSource';
import { validateSlidesElementAiEditStructuredContext } from '../features/elementAiEdit/functions/elementAiEditStructuredContextRequirement';
import { slidesApi } from '../services/slidesApi';
import { registerMessageCatalogs } from '@app/localization';
import { SLIDES_TOOL_CARD_MESSAGE_CATALOG } from '../tool-cards/definitions/slidesToolCardMessageCatalog';
import { SLIDES_PREVIEW_MESSAGE_CATALOG } from '../features/previewRenderState/definitions/slidesPreviewMessageCatalog';

function readSlidesDeckPageContextInput(): SlidesDeckPageContextInput {
  const slidesStore = useSlidesStore();
  return {
    currentDeckId: slidesStore.currentDeckId,
    deckPreview: slidesStore.deckPreview,
    currentSlideIndex: slidesStore.currentSlideIndex,
  };
}

function buildSlidesDocumentInfo() {
  return buildSlidesPageContextDocument(readSlidesDeckPageContextInput());
}

function buildSlidesSelection() {
  const sourceSelectionStore = useSlidesSourceSelectionStore();
  const uiStore = useSlidesUiStore();
  return buildSlidesPageContextSelection({
    sourceSelectedElementIds: sourceSelectionStore.selectedElementIds,
    selectedElementId: uiStore.selectedElementId,
  });
}

function buildSlidesSummary() {
  return buildSlidesPageContextSummary(readSlidesDeckPageContextInput());
}

function buildSlidesDocumentFragment(): string | null {
  return buildSlidesDocumentContextFragment(readSlidesDeckPageContextInput());
}

export function registerSlidesRendererPorts(): void {
  registerMessageCatalogs(SLIDES_TOOL_CARD_MESSAGE_CATALOG);
  registerMessageCatalogs(SLIDES_PREVIEW_MESSAGE_CATALOG);
  registerPluginDocumentCreationHandler({
    id: 'slides.document-create',
    async createDocument({ projectId, parentId, name }) {
      return createWorkspaceDocument({
        projectId,
        parentId,
        name,
        type: SLIDES_DOCUMENT_TYPE,
      });
    },
  });

  registerRendererPageContextProvider({
    id: 'slides.page-context',
    kind: SLIDES_ACTIVE_DOCUMENT_TYPE,
    documentType: SLIDES_DOCUMENT_TYPE,
    buildDocument: buildSlidesDocumentInfo,
    buildSelection: buildSlidesSelection,
    buildSummary: buildSlidesSummary,
    buildDocumentFragment: buildSlidesDocumentFragment,
  });

  registerDocumentReferenceRuntimeHandler({
    documentType: SLIDES_DOCUMENT_TYPE,
    referenceLabel: '幻灯片引用',
    getCurrentDocumentId() {
      return useSlidesStore().currentDeckId;
    },
    async listReferenceIds(documentId: string) {
      const preview = await slidesApi.getDeckPreview(documentId);
      return listSlidesReferenceIds({
        documentId,
        slides: preview.slides,
      });
    },
    async waitForDocumentReady(documentId: string, timeoutMs: number) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const store = useSlidesStore();
        if (store.currentDeckId === documentId && store.deckPreview !== null) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    },
    async focusReference({ documentId, referenceId }): Promise<DocumentReferenceFocusResult> {
      const slidesStore = useSlidesStore();
      if (slidesStore.currentDeckId !== documentId || slidesStore.deckPreview === null) {
        return { status: 'document-not-ready' };
      }

      const target = resolveSlidesReferenceFocusTarget({
        documentId,
        referenceId,
        slides: slidesStore.deckPreview.slides,
      });
      if (!target) {
        return { status: 'reference-not-found' };
      }

      useSlidesUiStore().selectElement(null);
      if (target.kind === 'slide') {
        slidesStore.setCurrentSlide(target.slideIndex);
      }
      return { status: 'focused' };
    },
  });

  registerRendererDocumentMutationHandler({
    id: 'slides.document-mutation',
    nodeType: SLIDES_DOCUMENT_TYPE,
    activeDocumentType: SLIDES_ACTIVE_DOCUMENT_TYPE,
    async handleMutation(event) {
      if (event.mutationKind !== 'version') return;
      const slidesStore = useSlidesStore();
      if (slidesStore.currentDeckId !== event.documentId) return;
      await slidesStore.refreshDeck(event.documentId);
    },
  });

  registerRendererStructuredContextRequirement({
    id: 'slides.element-ai-edit-context',
    validate: validateSlidesElementAiEditStructuredContext,
  });
}

export function unregisterSlidesRendererPorts(): void {
  unregisterPluginDocumentCreationHandler('slides.document-create');
  unregisterDocumentReferenceRuntimeHandler(SLIDES_DOCUMENT_TYPE);
  unregisterRendererPageContextProvider('slides.page-context');
  unregisterRendererDocumentMutationHandler('slides.document-mutation');
  unregisterRendererStructuredContextRequirement('slides.element-ai-edit-context');
  clearRenderableImageSourceCache();
}
