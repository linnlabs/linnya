import type { ConversationMetadata } from '../services/historyApiService';

export function buildConversationMetadataPatch(
  metadata: ConversationMetadata | null,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (metadata?.project_id !== undefined) {
    patch.projectId = metadata.project_id ?? undefined;
  }
  return patch;
}
