import {
  ConversationCommandPermissionResultSchema,
  type ConversationCommandPermissionRequest,
  type ConversationCommandPermissionResult,
} from '@app/schemas/commands';

export async function requestConversationCommandPermission(
  request: ConversationCommandPermissionRequest,
): Promise<ConversationCommandPermissionResult> {
  try {
    return ConversationCommandPermissionResultSchema.parse(
      await window.electronAPI.requestConversationCommandPermission(request),
    );
  } catch {
    return { kind: 'error', code: 'unavailable' };
  }
}
