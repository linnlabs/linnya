import { spawn } from 'node:child_process';
import process from 'node:process';
import type { Writable } from 'node:stream';

import type { CommandPipeOutputChannel } from '@app/schemas/commands';
import { decodeCommandOutputStreams } from '../../../src/infra/adapters/command-runtime/output/decodeCommandOutputStreams';
import { createStableCommandOutputLogicalLineStream } from '../../../src/infra/adapters/command-runtime/output/functions/createStableCommandOutputLogicalLineStream';
import { createStreamingControlSequenceParser } from '../../../src/infra/adapters/command-runtime/output/functions/createStreamingControlSequenceParser';

const CHILD_FLAG = '--logical-line-child';

type E2eCaseName = 'progress-and-crlf' | 'overwritten-long-frame' | 'final-long-line';

interface StreamProjectionResult {
  readonly text: string;
  readonly omittedCharacters: number;
  readonly parserIncomplete: boolean;
}

interface PipeProjectionResult {
  readonly stdout: StreamProjectionResult;
  readonly stderr: StreamProjectionResult;
}

async function writePieces(stream: Writable, pieces: readonly string[]): Promise<void> {
  for (const piece of pieces) {
    await new Promise<void>((resolve, reject) => {
      stream.write(piece, error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function runChild(caseName: E2eCaseName): Promise<void> {
  switch (caseName) {
    case 'progress-and-crlf':
      await Promise.all([
        writePieces(process.stdout, [
          'start\n10%', '\r20%\r', '100%\r', '\u001b[31m', '\u001b[0m\n', 'tail\r',
        ]),
        writePieces(process.stderr, ['warn\r', '\nready\n']),
      ]);
      return;
    case 'overwritten-long-frame':
      await writePieces(process.stdout, ['x'.repeat(1024 * 1024), '\r', 'done\n']);
      await writePieces(process.stderr, ['old\r', 'new']);
      return;
    case 'final-long-line':
      await writePieces(process.stdout, [`HEAD${'x'.repeat(1024 * 1024)}TAIL\r`]);
      await writePieces(process.stderr, ['plain\n']);
      return;
  }
}

async function projectRealPipe(caseName: E2eCaseName): Promise<PipeProjectionResult> {
  const currentEntry = process.argv[1];
  if (!currentEntry) throw new Error('logical line E2E entry path is unavailable');
  const child = spawn(process.execPath, [
    ...process.execArgv,
    currentEntry,
    CHILD_FLAG,
    caseName,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const decoders = decodeCommandOutputStreams('utf-8');
  const parsers = {
    stdout: createStreamingControlSequenceParser(),
    stderr: createStreamingControlSequenceParser(),
  };
  const logicalLines = {
    stdout: createStableCommandOutputLogicalLineStream({
      maxCharactersPerCurrentLine: 20,
    }),
    stderr: createStableCommandOutputLogicalLineStream({
      maxCharactersPerCurrentLine: 20,
    }),
  };
  const text: Record<CommandPipeOutputChannel, string[]> = {
    stdout: [],
    stderr: [],
  };
  const omittedCharacters: Record<CommandPipeOutputChannel, number> = {
    stdout: 0,
    stderr: 0,
  };

  function acceptText(channel: CommandPipeOutputChannel, sanitizedText: string): void {
    const delta = logicalLines[channel].write(sanitizedText);
    text[channel].push(delta.stableText);
    omittedCharacters[channel] += delta.committedOmittedCharacters;
  }

  function acceptBytes(channel: CommandPipeOutputChannel, bytes: Uint8Array): void {
    const decoded = decoders.write(channel, bytes);
    acceptText(channel, parsers[channel].write(decoded));
  }

  child.stdout.on('data', (bytes: Buffer) => acceptBytes('stdout', bytes));
  child.stderr.on('data', (bytes: Buffer) => acceptBytes('stderr', bytes));

  const terminal = await new Promise<{
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
  }>(resolve => {
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  if (terminal.exitCode !== 0 || terminal.signal !== null) {
    throw new Error(
      `logical line child failed: exit=${String(terminal.exitCode)} signal=${String(terminal.signal)}`,
    );
  }

  function finalizeChannel(channel: CommandPipeOutputChannel): StreamProjectionResult {
    acceptText(channel, parsers[channel].write(decoders.finalize(channel)));
    const parserFinalization = parsers[channel].finalize();
    const lineFinalization = logicalLines[channel].finalize();
    text[channel].push(lineFinalization.stableText);
    omittedCharacters[channel] += lineFinalization.committedOmittedCharacters;
    return {
      text: text[channel].join(''),
      omittedCharacters: omittedCharacters[channel],
      parserIncomplete: parserFinalization.incompleteSequenceOmitted,
    };
  }
  return {
    stdout: finalizeChannel('stdout'),
    stderr: finalizeChannel('stderr'),
  };
}

function assertResult(
  actual: PipeProjectionResult,
  expected: PipeProjectionResult,
  caseName: E2eCaseName,
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${caseName} mismatch: ${JSON.stringify(actual)}`);
  }
}

async function main(): Promise<void> {
  const childFlagIndex = process.argv.indexOf(CHILD_FLAG);
  if (childFlagIndex !== -1) {
    const caseName = process.argv[childFlagIndex + 1];
    if (
      caseName !== 'progress-and-crlf'
      && caseName !== 'overwritten-long-frame'
      && caseName !== 'final-long-line'
    ) {
      throw new Error(`unknown child case: ${String(caseName)}`);
    }
    await runChild(caseName);
    return;
  }

  assertResult(await projectRealPipe('progress-and-crlf'), {
    stdout: {
      text: 'start\n100%\ntail',
      omittedCharacters: 0,
      parserIncomplete: false,
    },
    stderr: {
      text: 'warn\nready\n',
      omittedCharacters: 0,
      parserIncomplete: false,
    },
  }, 'progress-and-crlf');
  assertResult(await projectRealPipe('overwritten-long-frame'), {
    stdout: {
      text: 'done\n',
      omittedCharacters: 0,
      parserIncomplete: false,
    },
    stderr: {
      text: 'new',
      omittedCharacters: 0,
      parserIncomplete: false,
    },
  }, 'overwritten-long-frame');
  assertResult(await projectRealPipe('final-long-line'), {
    stdout: {
      text: `HEAD${'x'.repeat(6)}[... output omitted ...]${'x'.repeat(6)}TAIL`,
      omittedCharacters: 1024 * 1024 - 12,
      parserIncomplete: false,
    },
    stderr: {
      text: 'plain\n',
      omittedCharacters: 0,
      parserIncomplete: false,
    },
  }, 'final-long-line');

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cases: 3,
  })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
