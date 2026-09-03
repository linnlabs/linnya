import {
  HistoricalSharedMemoryListArgsSchema,
  HistoricalSharedMemoryListResultSchema,
  HistoricalSharedMemoryResourceListArgsSchema,
  HistoricalSharedMemoryResourceListResultSchema,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type {
  SharedMemoryListPresentationData,
  SharedMemoryListPresentationDocument,
} from '../definitions/sharedMemoryListPresentation';

export function projectSharedMemoryListPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<SharedMemoryListPresentationData> {
  const title = createConversationToolTitleDescriptor('conversation.tool.sharedMemory.list');

  if (input.status !== 'success') {
    return { data: { kind: 'lifecycle' }, title };
  }

  admitSharedMemoryListRequest(input);
  return {
    data: {
      kind: 'snapshot',
      documents: readSharedMemoryListDocuments(input),
    },
    title,
  };
}

function admitSharedMemoryListRequest(input: ToolPresentationProjectorInput): void {
  if (input.uiKey !== 'sharedmemory_list') {
    throw new Error(`Unsupported SharedMemory list presentation key: ${input.uiKey}`);
  }
  if (input.sourceToolName === 'sharedmemory_list') {
    HistoricalSharedMemoryListArgsSchema.parse(input.args);
    return;
  }
  if (input.sourceToolName === 'resource_list') {
    HistoricalSharedMemoryResourceListArgsSchema.parse(input.args);
    return;
  }
  throw new Error(`Unsupported SharedMemory list source tool: ${input.sourceToolName}`);
}

function readSharedMemoryListDocuments(
  input: ToolPresentationProjectorInput
): readonly SharedMemoryListPresentationDocument[] {
  if (input.sourceToolName === 'sharedmemory_list') {
    const result = HistoricalSharedMemoryListResultSchema.parse(input.result);
    return result.data.docs.map(document => ({
      name: document.name,
      sizeBytes: document.size_bytes,
      updatedAtMs: document.updated_at_ms,
    }));
  }

  const result = HistoricalSharedMemoryResourceListResultSchema.parse(input.result);
  return result.data.docs.map(document => ({
    name: document.name,
    sizeBytes: document.sizeBytes,
    updatedAtMs: document.updatedAtMs,
  }));
}
