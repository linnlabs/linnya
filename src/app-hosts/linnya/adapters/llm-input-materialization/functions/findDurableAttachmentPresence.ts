import type { ModelInputPlacement } from '@linnlabs/linnkit/runtime-kernel';
import type { DurableAttachmentPresence } from '../definitions/llmInputMaterializationGuard';

const NO_DURABLE_ATTACHMENTS: DurableAttachmentPresence = Object.freeze({
  found: false,
  placements: Object.freeze([]),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasDurableAttachments(message: Record<string, unknown>): boolean {
  const attachments = message.attachments;
  if (!Array.isArray(attachments)) return false;
  return attachments.some(
    attachment =>
      isRecord(attachment) && attachment.kind === 'image' && typeof attachment.sha256 === 'string'
  );
}

export function findDurableAttachmentPresence(
  messages: readonly unknown[]
): DurableAttachmentPresence {
  let found = false;
  let hasUserImage = false;
  let hasToolResultImage = false;

  for (const message of messages) {
    if (!isRecord(message) || !hasDurableAttachments(message)) continue;
    found = true;
    if (message.role === 'user') hasUserImage = true;
    if (message.role === 'tool') hasToolResultImage = true;
  }

  if (!found) return NO_DURABLE_ATTACHMENTS;

  const placements: ModelInputPlacement[] = [];
  if (hasUserImage) placements.push('user_image');
  if (hasToolResultImage) placements.push('tool_result_image');
  return Object.freeze({
    found: true,
    placements: Object.freeze(placements),
  });
}
