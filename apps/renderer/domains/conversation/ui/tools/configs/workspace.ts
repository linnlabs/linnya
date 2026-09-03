import { defineAsyncComponent } from 'vue';
import type { ToolUiEntry } from '../types';
import { ReadIcon } from '@linnya/renderer-ui/icons';
import { createStaticToolCompactStepProjector } from '../compact-step/functions/createStaticToolCompactStepProjector';
import { resolveReadFileUiKey } from '../image-read/functions/resolveReadFileUiKey';
import { projectWorkspaceReadFilePresentation } from '../workspace/functions/projectWorkspaceReadFilePresentation';

const WorkspaceReadFileCard = defineAsyncComponent(
  () => import('../workspace/WorkspaceReadFileCard.vue'),
);

/**
 * read_file 保留真实工具身份；成功结果到达后，alias 只按 owner schema 固定最终展示 key。
 */
export const workspaceReadToolConfigs: Record<string, ToolUiEntry> = {
  read_file: {
    resolveUiKey: resolveReadFileUiKey,
  },
  workspace_read_file: {
    component: WorkspaceReadFileCard,
    icon: ReadIcon,
    presentation: projectWorkspaceReadFilePresentation,
    compactStep: createStaticToolCompactStepProjector('conversation.tool.workspace.compact.read'),
    layout: { fullWidth: true, hideContent: true, disableHeaderHover: true },
  },
};
