import { ZodError } from 'zod';
import type { ConversationControlProgressFrame } from '@app/schemas';
import {
  LINNYA_CLI_EXIT,
  LINNYA_CLI_VERSION,
  LinnyaCliError,
  type ConversationControlConnectionPort,
  type LinnyaCliIo,
} from '../definitions/cli';
import { parseCliInvocation } from '../functions/parseCliInvocation';
import { exitCodeForError, projectCliError } from '../functions/projectCliError';
import { createConversationControlConnection } from './createConversationControlConnection';
import { watchConversationStatus } from './watchConversationStatus';

interface RunCliOptions {
  readonly connection?: ConversationControlConnectionPort;
  readonly io?: LinnyaCliIo;
  readonly now?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
}

export function linnyaCliUsage(): string {
  return [
    'Linnya conversation CLI',
    '',
    'Usage:',
    '  linnya send <message> [--conversation ID] [--agent ID] [--project ID] [--model ID] [--image-model ID] [--reasoning LEVEL]',
    '  linnya models',
    '  linnya list [--limit N] [--cursor CURSOR] [--search TEXT] [--project ID]',
    '  linnya messages <conversation-id> [--before N | --after N] [--limit N]',
    '  linnya status <conversation-id> [--run ID] [--watch] [--interval MS] [--timeout MS]',
    '  linnya respond <conversation-id> --interaction ID (--approve | --skip | --submit-json JSON | --modify-json JSON) [--project ID]',
    '  linnya stop <conversation-id> [--run ID] [--reason TEXT]',
    '  linnya result <conversation-id> [--run ID]',
    '  linnya audit <conversation-id> [--run ID]',
    '',
    'Output:',
    '  Single commands write one JSON value to stdout. status --watch writes JSONL frames.',
    '  Errors write one stable JSON value to stderr. --pretty is available for single commands.',
    '',
  ].join('\n');
}

function serialize(value: unknown, pretty: boolean): string {
  return `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
}

export async function runCli(
  argv: readonly string[],
  options: RunCliOptions = {},
): Promise<number> {
  const io = options.io ?? {
    write: text => process.stdout.write(text),
    writeError: text => process.stderr.write(text),
  };

  try {
    let invocation;
    try {
      invocation = parseCliInvocation(argv);
    } catch (error: unknown) {
      if (error instanceof LinnyaCliError) throw error;
      if (error instanceof ZodError) {
        throw new LinnyaCliError(
          'invalid_request',
          error.issues[0]?.message ?? 'Invalid CLI arguments',
        );
      }
      throw error;
    }

    if (invocation.kind === 'help') {
      io.write(linnyaCliUsage());
      return LINNYA_CLI_EXIT.success;
    }
    if (invocation.kind === 'version') {
      io.write(`${LINNYA_CLI_VERSION}\n`);
      return LINNYA_CLI_EXIT.success;
    }

    const client = await (options.connection ?? createConversationControlConnection()).connect();
    if (invocation.kind === 'status' && invocation.watch) {
      await watchConversationStatus({
        client,
        request: invocation.request,
        intervalMs: invocation.intervalMs,
        timeoutMs: invocation.timeoutMs,
        writeFrame: (frame: ConversationControlProgressFrame) => io.write(serialize(frame, false)),
        now: options.now,
        sleep: options.sleep,
      });
      return LINNYA_CLI_EXIT.success;
    }

    const response = await client.execute(invocation.request);
    io.write(serialize(response, invocation.pretty));
    return LINNYA_CLI_EXIT.success;
  } catch (error: unknown) {
    const projected = projectCliError(error);
    io.writeError(serialize(projected, false));
    return exitCodeForError(projected.error.code);
  }
}
