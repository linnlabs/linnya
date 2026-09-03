import { defineAsyncComponent } from 'vue';
import type { ToolCompactStepProjector, ToolUiConfig } from '@linnya/plugin-host-contract/renderer/toolUi';
import {
  DownloadIcon,
  ReadIcon,
} from '@linnya/renderer-ui/icons';
import {
  SLIDES_TOOL_CARD_MESSAGE_FALLBACKS,
  type SlidesToolCardMessageKey,
} from './definitions/slidesToolCardMessageCatalog';
import {
  projectSlidesExportPresentation,
  projectSlidesInspectPresentation,
  projectSlidesPlanPresentation,
} from './functions/projectSlidesToolPresentation';

function compactStep(key: SlidesToolCardMessageKey): ToolCompactStepProjector {
  return () => ({
    title: { key, fallback: SLIDES_TOOL_CARD_MESSAGE_FALLBACKS[key] },
  });
}

const PresentationActionCard = defineAsyncComponent(() => import('./presentation/PresentationActionCard.vue'));
const PresentationInspectCard = defineAsyncComponent(() => import('./presentation/PresentationInspectCard.vue'));
const PptPlanApprovalCard = defineAsyncComponent(() => import('./presentation/PptPlanApprovalCard.vue'));

export const presentationToolConfigs: Record<string, ToolUiConfig> = {
  'ppt_plan': {
    component: PptPlanApprovalCard,
    presentation: projectSlidesPlanPresentation,
    compactStep: compactStep('slides.tool.compact.plan'),
    layout: {
      hideBorder: true,
      hideBackground: true,
      noPadding: true,
      fullWidth: true,
      overflowVisible: true,
    },
  },

  'ppt_inspect': {
    component: PresentationInspectCard,
    icon: ReadIcon,
    presentation: projectSlidesInspectPresentation,
    compactStep: compactStep('slides.tool.compact.inspect'),
    layout: { fullWidth: true },
  },

  'ppt_export': {
    component: PresentationActionCard,
    icon: DownloadIcon,
    presentation: projectSlidesExportPresentation,
    compactStep: compactStep('slides.tool.compact.export'),
    layout: { fullWidth: true },
  },
};
