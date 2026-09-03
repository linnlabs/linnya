import { defineAsyncComponent } from 'vue';
import { TableIcon } from '@linnya/renderer-ui/icons';
import type { ToolUiConfig } from '@linnya/plugin-host-contract/renderer/toolUi';
import { TABLE_FILL_MESSAGE_FALLBACKS } from '../../definitions/tableFillMessageCatalog';
import { projectWriteToTablePresentation } from '../../functions/projectWriteToTablePresentation';

const WriteToTableCard = defineAsyncComponent(() => import('./WriteToTableCard.vue'));

export const tableFillToolCards: Readonly<Record<string, ToolUiConfig>> = {
  'write_to_table': {
    component: WriteToTableCard,
    icon: TableIcon,
    presentation: projectWriteToTablePresentation,
    compactStep: () => ({
      title: {
        key: 'tableFill.tool.write',
        fallback: TABLE_FILL_MESSAGE_FALLBACKS['tableFill.tool.write'],
      },
    }),
    layout: { fullWidth: true },
  },
};
