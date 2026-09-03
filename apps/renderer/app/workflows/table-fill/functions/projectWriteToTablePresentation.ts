import {
  WriteToTableArgsSchema,
  WriteToTableReplayResultSchema,
} from '@app/schemas';
import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '@linnya/plugin-host-contract/renderer/toolUi';

import { TABLE_FILL_MESSAGE_FALLBACKS } from '../definitions/tableFillMessageCatalog';
import type { WriteToTableCardPresentation } from '../definitions/writeToTableCardPresentation';

function preview(content: string): string {
  return content.length > 120 ? `${content.slice(0, 120)}…` : content;
}

export function projectWriteToTablePresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<WriteToTableCardPresentation> {
  if (input.sourceToolName !== 'write_to_table' || input.uiKey !== 'write_to_table') {
    throw new Error(
      `Unsupported write_to_table presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`,
    );
  }

  const args = WriteToTableArgsSchema.parse(input.args);
  const data = input.status === 'success'
    ? WriteToTableReplayResultSchema.parse(input.result).data
    : {
        content: args.content,
        mode: args.mode,
      };
  if (data.content !== args.content || data.mode !== args.mode) {
    throw new Error('write_to_table result does not match its admitted arguments.');
  }

  const modeKey = data.mode === 'replace'
    ? 'tableFill.tool.mode.replace'
    : 'tableFill.tool.mode.fill';
  return {
    data: {
      content: data.content,
      mode: data.mode,
      previewText: preview(data.content),
    },
    title: {
      text: {
        key: 'tableFill.tool.write',
        fallback: TABLE_FILL_MESSAGE_FALLBACKS['tableFill.tool.write'],
      },
      tag: {
        text: {
          key: modeKey,
          fallback: TABLE_FILL_MESSAGE_FALLBACKS[modeKey],
        },
        variant: 'info',
      },
    },
  };
}
