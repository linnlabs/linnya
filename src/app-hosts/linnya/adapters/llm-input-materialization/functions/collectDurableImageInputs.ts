import type {
  LlmImageInputPlacement,
  LlmRequestMessage,
} from 'linnkit/ports';
import type { RuntimeResourceRef } from 'linnkit/contracts';

export interface DurableImageInputPosition {
  readonly messageIndex: number;
  readonly attachmentIndex: number;
  readonly messageId?: string;
  readonly placement: LlmImageInputPlacement;
  readonly reference: RuntimeResourceRef;
}

function readMessageId(message: LlmRequestMessage): string | undefined {
  return 'id' in message && typeof message.id === 'string' ? message.id : undefined;
}

export function collectDurableImageInputs(
  messages: readonly LlmRequestMessage[],
): DurableImageInputPosition[] {
  const inputs: DurableImageInputPosition[] = [];
  messages.forEach((message, messageIndex) => {
    if (!('attachments' in message) || !message.attachments?.length) return;
    const placement: LlmImageInputPlacement = message.role === 'tool'
      ? 'tool_result_image'
      : 'user_image';
    message.attachments.forEach((reference, attachmentIndex) => {
      inputs.push({
        messageIndex,
        attachmentIndex,
        messageId: readMessageId(message),
        placement,
        reference,
      });
    });
  });
  return inputs;
}
