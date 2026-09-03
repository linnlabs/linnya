import type { RendererPluginContribution } from '../types';
import { ConversationAgentIds } from '@app/schemas';
import MarkdownDocumentSurface from './surfaces/MarkdownDocumentSurface.vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import { ResearchIcon } from '@linnya/renderer-ui/icons';
import { markdownHandler } from '@/domains/workspace/services/file-manager/handlers/markdown';
import { commonToolConfigs } from '@/domains/conversation/ui/tools/configs/common';
import { knowledgeBaseToolConfigs } from '@/domains/conversation/ui/tools/configs/knowledgeBase';
import { webToolConfigs } from '@/domains/conversation/ui/tools/configs/web';
import { resourceToolConfigs } from '@/domains/conversation/ui/tools/configs/resource';
import { workspaceReadToolConfigs } from '@/domains/conversation/ui/tools/configs/workspace';
import { tableFillToolCards } from '@/app/workflows/table-fill/ui/tool-card/tableFillToolCards';
import { commandExecutionToolConfigs } from '@/domains/conversation/features/command-execution-presentation';
import { platformHeaderOnlyToolCards } from './tool-cards/platformHeaderOnlyToolCards';

export const platformRendererPlugin: RendererPluginContribution = {
  meta: {
    id: 'platform',
    name: 'Linnya Platform',
    version: '1.0.0',
    description: 'Built-in Linnya renderer capabilities',
    developer: 'Linnya',
    builtin: true,
    required: true,
  },
  documentTypes: [
    {
      pluginId: 'platform',
      nodeType: 'document',
      activeDocumentType: 'editor',
      fileSessionType: 'markdown',
      createRequestType: 'document',
      createBackend: 'workspace-document',
      surfaceComponent: MarkdownDocumentSurface,
      fileHandler: markdownHandler,
      shellClass: 'for-editor',
      label: 'Document',
      createLabel: 'New document',
      defaultName: 'Untitled document',
      labelText: {
        key: 'plugins.contribution.documentType.document.label',
        fallback: 'Document',
      },
      createLabelText: {
        key: 'plugins.contribution.documentType.document.createLabel',
        fallback: 'New document',
      },
      defaultNameText: {
        key: 'plugins.contribution.documentType.document.defaultName',
        fallback: 'Untitled document',
      },
      iconComponent: DocumentIcon,
      iconClass: 'file-icon',
      createPriority: 10,
      canAddToKnowledgeBase: true,
      entityReferences: [
        {
          kind: 'document',
          uriPattern: 'linnya://document/{documentId}',
          description: 'Markdown document entity, used as the root entity for cross-plugin references.',
        },
        {
          kind: 'block',
          uriPattern: 'linnya://document/{documentId}#block/{blockId}',
          description: 'Markdown document block entity for references, evidence, and future plugin content targeting.',
        },
      ],
    },
  ],
  conversationAgentChoices: [
    {
      id: 'deep_research',
      agentId: ConversationAgentIds.DEEP_RESEARCH,
      menuText: 'Deep research',
      pillText: 'Research',
      ariaLabel: 'Enabled: Deep research',
      menuLocalizedText: {
        key: 'plugins.contribution.agentChoice.deepResearch.menuText',
        fallback: 'Deep research',
      },
      pillLocalizedText: {
        key: 'plugins.contribution.agentChoice.deepResearch.pillText',
        fallback: 'Research',
      },
      ariaLocalizedText: {
        key: 'plugins.contribution.agentChoice.deepResearch.ariaLabel',
        fallback: 'Enabled: Deep research',
      },
      iconComponent: ResearchIcon,
    },
  ],
  toolCards: {
    ...commonToolConfigs,
    ...workspaceReadToolConfigs,
    ...tableFillToolCards,
    ...knowledgeBaseToolConfigs,
    ...webToolConfigs,
    ...resourceToolConfigs,
    ...commandExecutionToolConfigs,
    ...platformHeaderOnlyToolCards,
  },
};
