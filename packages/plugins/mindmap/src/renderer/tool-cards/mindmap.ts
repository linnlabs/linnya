import { defineAsyncComponent } from 'vue'
import type { ToolCompactStepProjector, ToolUiConfig } from '@linnya/plugin-host-contract/renderer/toolUi'
import { AddIcon } from '@linnya/renderer-ui/icons'
import {
  MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS,
  type MindmapToolCardMessageKey,
} from './definitions/mindmapToolCardMessageCatalog'
import { projectMindmapCreateNodePresentation } from './functions/projectMindmapToolPresentation'

function compactStep(key: MindmapToolCardMessageKey): ToolCompactStepProjector {
  return () => ({ title: { key, fallback: MINDMAP_TOOL_CARD_MESSAGE_FALLBACKS[key] } })
}

const MindMapCreateNodeCard = defineAsyncComponent(() => import('./cards/MindMapCreateNodeCard.vue'))

const mindmapCreateNodeUiConfig: ToolUiConfig = {
  component: MindMapCreateNodeCard,
  icon: AddIcon,
  presentation: projectMindmapCreateNodePresentation,
  compactStep: compactStep('mindmap.tool.compact.createNode'),
  layout: { fullWidth: true, defaultCollapsed: true },
}

export const mindmapToolConfigs: Record<string, ToolUiConfig> = {
  mindmap_create_node: mindmapCreateNodeUiConfig,
  workspace_mindmap_create_node: mindmapCreateNodeUiConfig,
}
