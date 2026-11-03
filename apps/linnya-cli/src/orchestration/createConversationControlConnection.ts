import path from 'node:path';
import type { SourceCheckoutIdentity } from '../../../../src/shared/runtime-paths/definitions/sourceCheckoutIdentity';
import type { ConversationControlConnectionContext } from '@app/schemas';
import { resolveCliSourceCheckout } from '../functions/resolveCliSourceCheckout';
import { LinnyaCliError } from '../definitions/cli';
import { readConnectionDescriptor } from '../adapters/readConnectionDescriptor';
import { createHttpConversationControlClient } from '../adapters/httpConversationControlClient';
import type { ConversationControlConnectionPort } from '../definitions/cli';
import { resolveConnectionFile } from '../functions/resolveConnectionFile';

interface ConversationControlConnectionOptions {
  readonly connectionFile?: string;
  readonly sourceCheckout?: SourceCheckoutIdentity | null;
  readonly fetchImplementation?: typeof fetch;
  readonly requestTimeoutMs?: number;
}

export function createConversationControlConnection(
  options: ConversationControlConnectionOptions = {},
): ConversationControlConnectionPort {
  return {
    async connect() {
      const source = options.sourceCheckout === undefined ? resolveCliSourceCheckout() : options.sourceCheckout;
      const context: ConversationControlConnectionContext = {
        source_root: source?.root ?? null, branch: source?.branch ?? null,
        state: 'not_connected', instance: null,
      };
      try {
        const descriptor = await readConnectionDescriptor(
          options.connectionFile ?? resolveConnectionFile(process.env, undefined, source),
        );
        const client = await createHttpConversationControlClient({
          descriptor,
          fetchImplementation: options.fetchImplementation,
          requestTimeoutMs: options.requestTimeoutMs,
        });
        context.instance = client.handshake.instance;
        if (source && (context.instance.kind !== 'source'
          || path.relative(source.root, context.instance.source_root) !== '')) {
          context.state = 'rejected';
          throw new LinnyaCliError('source_mismatch',
            `CLI 源码目录：${source.root}；App 源码目录：${context.instance.source_root ?? '安装版（无源码目录）'}。目录不一致，拒绝连接。`);
        }
        return client;
      } catch (error: unknown) {
        if (error instanceof LinnyaCliError) error.connection = context;
        throw error;
      }
    },
  };
}
