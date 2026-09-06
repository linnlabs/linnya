import type { RendererPluginContribution } from '@plugin/renderer/pluginContribution';
import {
  MINDMAP_DOCUMENT_TYPE,
  MINDMAP_FILE_SESSION_TYPE,
  MINDMAP_PLUGIN_ID,
  MINDMAP_PLUGIN_META,
} from '@plugin/mindmap/shared';
import MindMapIcon from './icon/MindMapIcon.vue';
import MindMap from './core';
import MindmapPage from './page/MindmapPage.vue';
import { mindmapHandler } from './file-handler/mindmap';
import { mindmapToolConfigs } from './tool-cards/mindmap';
import {
  registerMindmapRendererPorts,
  unregisterMindmapRendererPorts,
} from './ports/registerMindmapRendererPorts';
import mindmapStylesheet from './styles/index.css?url';
import mindmapToolCardsStylesheet from './tool-cards/MindMapToolCards.css?url';

const mindmapStylesheets = [
  mindmapStylesheet,
  mindmapToolCardsStylesheet,
] as const;

export const mindmapRendererPlugin: RendererPluginContribution = {
  meta: MINDMAP_PLUGIN_META,
  stylesheets: mindmapStylesheets,
  activate: registerMindmapRendererPorts,
  deactivate: unregisterMindmapRendererPorts,
  documentTypes: [
    {
      pluginId: MINDMAP_PLUGIN_ID,
      nodeType: MINDMAP_DOCUMENT_TYPE,
      activeDocumentType: MINDMAP_DOCUMENT_TYPE,
      fileSessionType: MINDMAP_FILE_SESSION_TYPE,
      createRequestType: MINDMAP_DOCUMENT_TYPE,
      createBackend: 'plugin-document',
      createHandlerId: 'mindmap.document-create',
      surfaceComponent: MindmapPage,
      fileHandler: mindmapHandler,
      shellClass: 'for-mindmap',
      label: '思维导图',
      createLabel: '新建思维导图',
      defaultName: '未命名思维导图',
      iconComponent: MindMapIcon,
      iconClass: 'mindmap-icon',
      createPriority: 20,
      canAddToKnowledgeBase: true,
      entityReferences: [
        {
          kind: 'document',
          uriPattern: 'linnya://mindmap/{documentId}',
          description: 'Mindmap 文档本体。',
        },
        {
          kind: 'node',
          uriPattern: 'linnya://mindmap/{documentId}#node/{nodeId}',
          description: 'Mindmap 节点，用于定位文本大纲中的结构位置。',
        },
      ],
    },
  ],
  toolCards: mindmapToolConfigs,
};

export const rendererPlugin = mindmapRendererPlugin;

export default MindMap;
export { MindmapPage, MindMapIcon, mindmapHandler, mindmapToolConfigs };
export { mindMapGateway } from './ipc/mindMapGateway';
export type {
  IMindMapGateway,
  MindMapMetadata,
  MindMapViewport,
} from './ipc/mindMapGateway';
export {
  getMindMapAdapter,
  registerMindMapAdapter,
} from './file-handler/mindmapAdapterBridge';
export type {
  MindMapAdapter,
  MindMapAdapterSession,
  MindMapSerializableState,
} from './file-handler/mindmapAdapterBridge';
export {
  DEFAULT_MINDMAP_CHAT_CONTEXT_OPTIONS,
  buildMindMapChatDocumentFragmentFromStore,
} from './utils/mindmapAiContext';
export type {
  MindMapChatContextOptions,
  PageContextLike,
} from './utils/mindmapAiContext';
export { useMindMapStore } from './domain/store/mindmapStore';
export type { Topic } from './domain/types/dom';
export type * from './core';
export {
  registerMindmapRendererPorts,
  unregisterMindmapRendererPorts,
} from './ports/registerMindmapRendererPorts';
