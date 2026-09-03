import { readConnectionDescriptor } from '../adapters/readConnectionDescriptor';
import { createHttpConversationControlClient } from '../adapters/httpConversationControlClient';
import type { ConversationControlConnectionPort } from '../definitions/cli';
import { resolveConnectionFile } from '../functions/resolveConnectionFile';

interface ConversationControlConnectionOptions {
  readonly connectionFile?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

export function createConversationControlConnection(
  options: ConversationControlConnectionOptions = {},
): ConversationControlConnectionPort {
  return {
    async connect() {
      const descriptor = await readConnectionDescriptor(
        options.connectionFile ?? resolveConnectionFile(),
      );
      return createHttpConversationControlClient({
        descriptor,
        fetchImplementation: options.fetchImplementation,
        requestTimeoutMs: options.requestTimeoutMs,
      });
    },
  };
}
