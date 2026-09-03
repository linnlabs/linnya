/**
 * @file configs/web.ts
 * @description 联网工具（Web Search + Web Read）UI 配置
 */

import { defineAsyncComponent } from 'vue';
import type { ToolUiConfig } from '../types';
import { SearchIcon } from '@linnya/renderer-ui/icons';
import { ReadIcon } from '@linnya/renderer-ui/icons';
import { projectWebSearchPresentation } from '../websearch/functions/projectWebSearchPresentation';
import { projectWebSearchCompactStep } from '../websearch/functions/projectWebSearchPresentation';
import { projectWebReadPresentation } from '../webread/functions/projectWebReadPresentation';
import { createStaticToolCompactStepProjector } from '../compact-step/functions/createStaticToolCompactStepProjector';

const readWebPageCompactStep = createStaticToolCompactStepProjector(
  'conversation.tool.webRead.configTitle',
);

const WebSearchCard = defineAsyncComponent(() => import('../websearch/WebSearchCard.vue'));
const WebReadCard = defineAsyncComponent(() => import('../webread/WebReadCard.vue'));

export const webToolConfigs: Record<string, ToolUiConfig> = {
  'web_search': {
    component: WebSearchCard,
    icon: SearchIcon,
    presentation: projectWebSearchPresentation,
    compactStep: projectWebSearchCompactStep,
    layout: { fullWidth: true, defaultCollapsed: true },
  },

  'web_read': {
    component: WebReadCard,
    icon: ReadIcon,
    presentation: projectWebReadPresentation,
    compactStep: readWebPageCompactStep,
    layout: { fullWidth: true, defaultCollapsed: true },
  },
};
