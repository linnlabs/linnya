import { promises as fs } from 'node:fs';
import {
  CONVERSATION_CONTROL_PROTOCOL_VERSION,
  ConversationControlConnectionDescriptorSchema,
  type ConversationControlConnectionDescriptor,
} from '@app/schemas';
import { LinnyaCliError } from '../definitions/cli';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function readConnectionDescriptor(
  connectionFile: string,
): Promise<ConversationControlConnectionDescriptor> {
  let content: string;
  try {
    content = await fs.readFile(connectionFile, 'utf8');
  } catch (error: unknown) {
    if (isMissingFile(error)) {
      throw new LinnyaCliError(
        'app_not_running',
        'Linnya App is not running or has not opened its conversation-control bridge',
        true,
      );
    }
    throw new LinnyaCliError('transport_failure', 'Cannot read Linnya connection file', true);
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    throw new LinnyaCliError('stale_connection', 'Linnya connection file is invalid', true);
  }
  if (
    isRecord(decoded)
    && decoded.protocol_version !== undefined
    && decoded.protocol_version !== CONVERSATION_CONTROL_PROTOCOL_VERSION
  ) {
    throw new LinnyaCliError(
      'protocol_incompatible',
      `CLI protocol ${CONVERSATION_CONTROL_PROTOCOL_VERSION} is incompatible with the running App`,
    );
  }
  const parsed = ConversationControlConnectionDescriptorSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new LinnyaCliError('stale_connection', 'Linnya connection file is invalid', true);
  }
  return parsed.data;
}
