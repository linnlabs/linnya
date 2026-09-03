import {
  HistoricalSharedMemoryWriteArgsSchema,
  HistoricalSharedMemoryWriteResultSchema,
} from '@app/schemas';
import { countTextUnitsZhEn } from '@/shared/utils/textUnits';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { SharedMemoryWritePresentationData } from '../definitions/sharedMemoryWritePresentation';

export function projectSharedMemoryWritePresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<SharedMemoryWritePresentationData> {
  if (input.sourceToolName !== 'sharedmemory_write' || input.uiKey !== 'sharedmemory_write') {
    throw new Error(
      `Unsupported SharedMemory write presentation: source=${input.sourceToolName}, uiKey=${input.uiKey}`
    );
  }

  const title = createConversationToolTitleDescriptor('conversation.tool.sharedMemory.write');

  if (input.status !== 'success') {
    const args = HistoricalSharedMemoryWriteArgsSchema.safeParse(input.args);
    const documentName = args.success ? ensureMarkdownDocumentName(args.data.doc_name) : undefined;
    const contentUnits = args.success ? countTextUnitsZhEn(args.data.content) : undefined;
    return {
      data: {
        kind: 'lifecycle',
        ...(documentName ? { documentName } : {}),
        ...(contentUnits === undefined ? {} : { contentUnits }),
      },
      title,
    };
  }

  const args = HistoricalSharedMemoryWriteArgsSchema.parse(input.args);
  const contentUnits = countTextUnitsZhEn(args.content);
  const result = HistoricalSharedMemoryWriteResultSchema.parse(input.result);
  return {
    data: {
      kind: 'snapshot',
      documentName: ensureMarkdownDocumentName(result.data.doc_name),
      contentUnits,
      action: result.data.action,
      operation: result.data.operation,
      version: result.data.version,
    },
    title,
  };
}

function ensureMarkdownDocumentName(name: string): string {
  return name.toLowerCase().endsWith('.md') ? name : `${name}.md`;
}
