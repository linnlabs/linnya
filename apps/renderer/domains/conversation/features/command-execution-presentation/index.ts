import { defineAsyncComponent } from 'vue';
import type { ToolUiConfig } from '@linnya/plugin-host-contract/renderer/toolUi';

import { TerminalIcon } from '@linnya/renderer-ui/icons';
import {
  projectCommandExecutionCompactStep,
  projectCommandExecutionPresentation,
} from './functions/projectCommandExecutionPresentation';

const CommandExecutionCard = defineAsyncComponent(
  () => import('./ui/CommandExecutionCard.vue'),
);

const commandExecutionConfig: ToolUiConfig = {
  component: CommandExecutionCard,
  icon: TerminalIcon,
  presentation: projectCommandExecutionPresentation,
  compactStep: projectCommandExecutionCompactStep,
  layout: {
    fullWidth: true,
    defaultCollapsed: true,
  },
  runtime: { conversationId: true },
};

export const commandExecutionToolConfigs: Readonly<Record<string, ToolUiConfig>> = {
  shell: commandExecutionConfig,
  process: commandExecutionConfig,
};

export { aggregateCommandExecutionMessages } from './functions/aggregateCommandExecutionMessages';
export { projectCommandExecutionPresentation } from './functions/projectCommandExecutionPresentation';
export { projectCommandExecutionCompactStep } from './functions/projectCommandExecutionPresentation';
