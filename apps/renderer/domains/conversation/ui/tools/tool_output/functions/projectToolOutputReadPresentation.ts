import {
  HistoricalToolOutputResourceReadResultSchema,
  parseToolOutputReadResult,
} from '@app/schemas';
import type {
  ToolPresentationProjection,
  ToolPresentationProjectorInput,
} from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { ToolOutputReadPresentationData } from '../definitions/toolOutputReadPresentation';

export function projectToolOutputReadPresentation(
  input: ToolPresentationProjectorInput,
): ToolPresentationProjection<ToolOutputReadPresentationData> {
  const title = createConversationToolTitleDescriptor('conversation.tool.output.continue');
  if (input.status !== 'success') {
    return { data: { kind: 'lifecycle' }, title };
  }

  const result = input.sourceToolName === 'resource_read'
    ? (() => {
        const historical = HistoricalToolOutputResourceReadResultSchema.parse(input.result).data;
        const { uri: _uri, source: _source, ...canonical } = historical;
        return canonical;
      })()
    : parseToolOutputReadResult(input.result).data;
  const characterStart = result.start_offset + 1;
  return {
    data: {
      kind: 'snapshot',
      result,
      lineRange: `${result.start_line}-${result.end_line} / ${result.total_lines} · ${characterStart}-${result.end_offset_exclusive} / ${result.total_chars}`,
    },
    title,
  };
}
