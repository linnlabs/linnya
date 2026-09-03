/**
 * @file configs/knowledgeBase.ts
 * @description 知识库相关工具 UI 配置
 */

import { defineAsyncComponent } from 'vue';
import type { ToolUiConfig } from '../types';
import { KnowledgeBaseIcon } from '@linnya/renderer-ui/icons';
import { ReadIcon } from '@linnya/renderer-ui/icons';
import { projectDocumentListPresentation } from '../knowledge/functions/projectDocumentListPresentation';
import { projectDocumentContentPresentation } from '../knowledge/functions/projectDocumentContentPresentation';
import { projectKnowledgeSearchPresentation } from '../knowledgebasesearchcard/functions/projectKnowledgeSearchPresentation';
import { projectKnowledgeSearchCompactStep } from '../knowledgebasesearchcard/functions/projectKnowledgeSearchPresentation';
import { createStaticToolCompactStepProjector } from '../compact-step/functions/createStaticToolCompactStepProjector';

const listKnowledgeBaseCompactStep = createStaticToolCompactStepProjector(
  'conversation.tool.knowledgeSearch.configListTitle',
);
const readKnowledgeDocumentCompactStep = createStaticToolCompactStepProjector(
  'conversation.tool.knowledgeSearch.configReadDocument',
);

const KnowledgeSearchCard = defineAsyncComponent(
  () => import('../knowledgebasesearchcard/KnowledgeSearchCard.vue')
);
const DocumentListCard = defineAsyncComponent(() => import('../knowledge/DocumentListCard.vue'));
const DocumentContentCard = defineAsyncComponent(
  () => import('../knowledge/DocumentContentCard.vue')
);

export const knowledgeBaseToolConfigs: Record<string, ToolUiConfig> = {
  list_knowledge_base: {
    component: DocumentListCard,
    icon: KnowledgeBaseIcon,
    presentation: projectDocumentListPresentation,
    compactStep: listKnowledgeBaseCompactStep,
    layout: { fullWidth: true },
  },

  knowledge_search: {
    component: KnowledgeSearchCard,
    icon: KnowledgeBaseIcon,
    presentation: projectKnowledgeSearchPresentation,
    compactStep: projectKnowledgeSearchCompactStep,
    runtime: { subrunTrace: true, conversationId: true },
    layout: {
      fullWidth: true,
      defaultCollapsed: true,
    },
  },

  /** 只接纳历史会话中已经持久化的旧 Tool 事件，不对应后端可执行工具。 */
  search_knowledge_base: {
    component: KnowledgeSearchCard,
    icon: KnowledgeBaseIcon,
    presentation: projectKnowledgeSearchPresentation,
    compactStep: projectKnowledgeSearchCompactStep,
    runtime: { subrunTrace: true, conversationId: true },
    layout: {
      fullWidth: true,
      defaultCollapsed: true,
    },
  },

  /**
   * search_in_knowledgebase（浅搜索别名）
   *
   * 根因说明：
   * - 后端提供该工具名，是为了让子 Agent 根本"看不到 deep_search 参数"；
   * - UI 行为与 knowledge_search 的浅搜索模式完全一致。
   */
  search_in_knowledgebase: {
    component: KnowledgeSearchCard,
    icon: KnowledgeBaseIcon,
    presentation: projectKnowledgeSearchPresentation,
    compactStep: projectKnowledgeSearchCompactStep,
    runtime: { subrunTrace: true, conversationId: true },
    layout: { fullWidth: true, defaultCollapsed: true },
  },

  /** search_in_knowledge_base */
  search_in_knowledge_base: {
    component: KnowledgeSearchCard,
    icon: KnowledgeBaseIcon,
    presentation: projectKnowledgeSearchPresentation,
    compactStep: projectKnowledgeSearchCompactStep,
    runtime: { subrunTrace: true, conversationId: true },
    layout: { fullWidth: true, defaultCollapsed: true },
  },

  knowledge_read: {
    component: DocumentContentCard,
    icon: ReadIcon,
    presentation: projectDocumentContentPresentation,
    compactStep: readKnowledgeDocumentCompactStep,
    layout: { fullWidth: true },
  },

  /** 只接纳历史会话中已经持久化的旧 Tool 事件，不对应后端可执行工具。 */
  browse_document_by_chunk: {
    component: DocumentContentCard,
    icon: ReadIcon,
    presentation: projectDocumentContentPresentation,
    compactStep: readKnowledgeDocumentCompactStep,
    layout: { fullWidth: true },
  },
};
