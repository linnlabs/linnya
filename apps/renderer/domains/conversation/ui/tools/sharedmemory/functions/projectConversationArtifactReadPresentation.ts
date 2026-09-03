import {
  HistoricalConversationArtifactResourceReadArgsSchema,
  HistoricalSharedMemoryReadArgsSchema,
  parseHistoricalConversationArtifactReadResult,
  type HistoricalConversationArtifactReadSource,
} from '@app/schemas';
import type { ToolPresentationProjection, ToolPresentationProjectorInput } from '../../types';
import { createConversationToolTitleDescriptor } from '../../functions/createConversationToolTitleDescriptor';
import type { ConversationArtifactReadPresentationData } from '../definitions/conversationArtifactReadPresentation';

export function projectConversationArtifactReadPresentation(
  input: ToolPresentationProjectorInput
): ToolPresentationProjection<ConversationArtifactReadPresentationData> {
  if (input.status !== 'success') {
    const lifecycleSource = readLifecycleSource(input);
    return {
      data: { kind: 'lifecycle', ...(lifecycleSource ? { source: lifecycleSource } : {}) },
      title: createConversationToolTitleDescriptor(
        lifecycleSource ? readTitleKey(lifecycleSource) : 'conversation.tool.sharedMemory.read'
      ),
    };
  }
  const requestedSource = readRequestedSource(input);
  const title = createConversationToolTitleDescriptor(readTitleKey(requestedSource));

  const result = parseHistoricalConversationArtifactReadResult(input.result);
  if (result.data.source !== requestedSource) {
    throw new Error(
      `Conversation artifact result source mismatch: requested=${requestedSource}, result=${result.data.source}`
    );
  }

  return {
    data: {
      kind: 'snapshot',
      source: result.data.source,
      artifact: result.data,
    },
    title,
  };
}

function readLifecycleSource(
  input: ToolPresentationProjectorInput
): HistoricalConversationArtifactReadSource | undefined {
  if (input.sourceToolName === 'sharedmemory_read') {
    return HistoricalSharedMemoryReadArgsSchema.safeParse(input.args).success
      ? 'shared_memory'
      : undefined;
  }
  if (input.sourceToolName !== 'resource_read') return undefined;
  const parsed = HistoricalConversationArtifactResourceReadArgsSchema.safeParse(input.args);
  if (!parsed.success) return undefined;
  if (parsed.data.uri.startsWith('shared_memory://')) return 'shared_memory';
  if (parsed.data.uri.startsWith('evidence://')) return 'evidence';
  if (parsed.data.uri.startsWith('citation_snapshot://')) return 'citation_snapshot';
  return undefined;
}

function readRequestedSource(
  input: ToolPresentationProjectorInput
): HistoricalConversationArtifactReadSource {
  if (input.sourceToolName === 'sharedmemory_read') {
    HistoricalSharedMemoryReadArgsSchema.parse(input.args);
    return 'shared_memory';
  }

  if (input.sourceToolName === 'resource_read') {
    const { uri } = HistoricalConversationArtifactResourceReadArgsSchema.parse(input.args);
    if (uri.startsWith('shared_memory://')) return 'shared_memory';
    if (uri.startsWith('evidence://')) return 'evidence';
    if (uri.startsWith('citation_snapshot://')) return 'citation_snapshot';
  }

  throw new Error(`Unsupported conversation artifact read source tool: ${input.sourceToolName}`);
}

function readTitleKey(
  source: HistoricalConversationArtifactReadSource
):
  | 'conversation.tool.sharedMemory.read'
  | 'conversation.tool.sharedMemory.readEvidence'
  | 'conversation.tool.sharedMemory.readCitationSnapshot' {
  if (source === 'shared_memory') return 'conversation.tool.sharedMemory.read';
  if (source === 'evidence') return 'conversation.tool.sharedMemory.readEvidence';
  return 'conversation.tool.sharedMemory.readCitationSnapshot';
}
