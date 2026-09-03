/**
 * @file configs/mindmap.ts
 * @description MindMap Workspace Tools（Reasoning Canvas）UI 配置
 *
 * 包含：
 * - mindmap_tag_node / mindmap_attach_evidence / mindmap_create_node（+兼容别名）
 * - mindmap_subrun_*（子 Agent runner，复用 SubrunCard 做 UiCardGroup 渲染）
 */

import { defineAsyncComponent } from 'vue';
import type { ToolCompactStepProjector, ToolUiConfig } from '@linnya/plugin-host-contract/renderer/toolUi';
import {
  AddIcon,
  LinkIcon,
  ListIcon,
  TagIcon,
} from '@linnya/renderer-ui/icons';
import { SubrunCard } from '@plugin/renderer/subrunToolUi';
import {
  MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS,
  type MindmapToolCardMessageKey,
} from './definitions/mindmapToolCardMessageCatalog';
import {
  projectMindmapAttachEvidencePresentation,
  projectMindmapCreateNodePresentation,
  projectMindmapParallelSubrunPresentation,
  projectMindmapSingleSubrunPresentation,
  projectMindmapTagNodePresentation,
} from './functions/projectMindmapToolPresentation';

function compactStep(key: MindmapToolCardMessageKey): ToolCompactStepProjector {
  return () => ({
    title: { key, fallback: MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS[key] },
  });
}

const MindMapTagNodeCard = defineAsyncComponent(() => import('./cards/MindMapTagNodeCard.vue'));
const MindMapAttachEvidenceCard = defineAsyncComponent(
  () => import('./cards/MindMapAttachEvidenceCard.vue')
);
const MindMapCreateNodeCard = defineAsyncComponent(
  () => import('./cards/MindMapCreateNodeCard.vue')
);
const MindMapSubrunParallelCard = defineAsyncComponent(
  () => import('./cards/MindMapSubrunParallelCard.vue')
);

const mindmapTagNodeUiConfig: ToolUiConfig = {
  component: MindMapTagNodeCard,
  icon: TagIcon,
  presentation: projectMindmapTagNodePresentation,
  compactStep: compactStep('mindmap.tool.compact.tagNode'),
  layout: { fullWidth: true, defaultCollapsed: true },
};

const mindmapAttachEvidenceUiConfig: ToolUiConfig = {
  component: MindMapAttachEvidenceCard,
  icon: LinkIcon,
  presentation: projectMindmapAttachEvidencePresentation,
  compactStep: compactStep('mindmap.tool.compact.attachEvidence'),
  layout: { fullWidth: true, defaultCollapsed: true },
};

const mindmapCreateNodeUiConfig: ToolUiConfig = {
  component: MindMapCreateNodeCard,
  icon: AddIcon,
  presentation: projectMindmapCreateNodePresentation,
  compactStep: compactStep('mindmap.tool.compact.createNode'),
  layout: { fullWidth: true, defaultCollapsed: true },
};

/** MindMap subrun 工具共享的 renderAsGroup 布局 */
const subrunGroupLayout: ToolUiConfig['layout'] = {
  fullWidth: true,
  defaultCollapsed: false,
  hideBorder: true,
  hideBackground: true,
  noPadding: true,
  renderAsGroup: true,
};

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------

export const mindmapToolConfigs: Record<string, ToolUiConfig> = {
  'mindmap_tag_node': mindmapTagNodeUiConfig,
  'workspace_mindmap_tag_node': mindmapTagNodeUiConfig,

  'mindmap_attach_evidence': mindmapAttachEvidenceUiConfig,
  'workspace_mindmap_attach_evidence': mindmapAttachEvidenceUiConfig,

  'mindmap_create_node': mindmapCreateNodeUiConfig,
  'workspace_mindmap_create_node': mindmapCreateNodeUiConfig,

  /**
   * MindMap Workflow 子 Agent runner：
   * 复用 SubrunCard（消费 subrun_trace），renderAsGroup 模式。
   */
  'mindmap_subrun_decompose': {
    component: SubrunCard,
    icon: ListIcon,
    presentation: projectMindmapSingleSubrunPresentation,
    compactStep: compactStep('mindmap.tool.compact.decompose'),
    runtime: { subrunTrace: true },
    layout: subrunGroupLayout,
  },
  'mindmap_subrun_propose': {
    component: SubrunCard,
    icon: ListIcon,
    presentation: projectMindmapSingleSubrunPresentation,
    compactStep: compactStep('mindmap.tool.compact.propose'),
    runtime: { subrunTrace: true },
    layout: subrunGroupLayout,
  },
  'mindmap_subrun_validate': {
    component: SubrunCard,
    icon: ListIcon,
    presentation: projectMindmapSingleSubrunPresentation,
    compactStep: compactStep('mindmap.tool.compact.validate'),
    runtime: { subrunTrace: true },
    layout: subrunGroupLayout,
  },
  'mindmap_subrun_parallel': {
    component: MindMapSubrunParallelCard,
    icon: ListIcon,
    presentation: projectMindmapParallelSubrunPresentation,
    compactStep: compactStep('mindmap.tool.compact.parallel'),
    runtime: { subrunTrace: true },
    layout: subrunGroupLayout,
  },
};
