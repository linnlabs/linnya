import { spawn } from 'node:child_process';
import process from 'node:process';
import type { Writable } from 'node:stream';

import type { CommandPipeOutputChannel } from '@app/schemas/commands';
import { decodeCommandOutputStreams } from '../../../src/infra/adapters/command-runtime/output/decodeCommandOutputStreams';
import { createStreamingControlSequenceParser } from '../../../src/infra/adapters/command-runtime/output/functions/createStreamingControlSequenceParser';

const CHILD_FLAG = '--control-sequence-child';

type E2eCaseName = 'ansi-and-osc' | 'c1-and-strings' | 'incomplete-string';

interface PipeProjectionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutIncomplete: boolean;
  readonly stderrIncomplete: boolean;
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
    case 'ansi-and-osc':
      await Promise.all([
        writePieces(process.stdout, [
          'A\u001b', '[31', 'mred\u001b[0m',
          '\u001b]52;c;YWJj', '\u0007safe\n',
        ]),
        writePieces(process.stderr, ['warn\u001b]0;title', '\u001b\\done\n']),
      ]);
      return;
    case 'c1-and-strings':
      await Promise.all([
        writePieces(process.stdout, ['A\u009b31mB\u009b0m', '\u0090payload', '\u009cC\n']),
        writePieces(process.stderr, ['D\u001bPpayload\u0007still', '\u001b\\E\n']),
      ]);
      return;
    case 'incomplete-string':
      await writePieces(process.stdout, ['before\n\u001b]0;', 'x'.repeat(1024 * 1024)]);
      await writePieces(process.stderr, ['plain\ttext\u0007\n']);
      return;
  }
}

async function projectRealPipe(caseName: E2eCaseName): Promise<PipeProjectionResult> {
  const currentEntry = process.argv[1];
  if (!currentEntry) throw new Error('control sequence E2E entry path is unavailable');
  // 源码态继承 tsx loader，CommonJS bundle 态的 execArgv 为空；两种入口因此走同一 child 合同。
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
  const stdoutParser = createStreamingControlSequenceParser();
  const stderrParser = createStreamingControlSequenceParser();
  const output: Record<CommandPipeOutputChannel, string[]> = {
    stdout: [],
    stderr: [],
  };

  function accept(channel: CommandPipeOutputChannel, bytes: Uint8Array): void {
    const decoded = decoders.write(channel, bytes);
    const parser = channel === 'stdout' ? stdoutParser : stderrParser;
    output[channel].push(parser.write(decoded));
  }

  child.stdout.on('data', (bytes: Buffer) => accept('stdout', bytes));
  child.stderr.on('data', (bytes: Buffer) => accept('stderr', bytes));

  const terminal = await new Promise<{
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
  }>(resolve => {
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  const { exitCode, signal } = terminal;
  if (exitCode !== 0 || signal !== null) {
    throw new Error(`control sequence child failed: exit=${String(exitCode)} signal=${String(signal)}`);
  }

  output.stdout.push(stdoutParser.write(decoders.finalize('stdout')));
  output.stderr.push(stderrParser.write(decoders.finalize('stderr')));
  const stdoutFinal = stdoutParser.finalize();
  const stderrFinal = stderrParser.finalize();
  return {
    stdout: output.stdout.join(''),
    stderr: output.stderr.join(''),
    stdoutIncomplete: stdoutFinal.incompleteSequenceOmitted,
    stderrIncomplete: stderrFinal.incompleteSequenceOmitted,
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
      caseName !== 'ansi-and-osc'
      && caseName !== 'c1-and-strings'
      && caseName !== 'incomplete-string'
    ) {
      throw new Error(`unknown child case: ${String(caseName)}`);
    }
    await runChild(caseName);
    return;
  }

  assertResult(await projectRealPipe('ansi-and-osc'), {
    stdout: 'Aredsafe\n',
    stderr: 'warndone\n',
    stdoutIncomplete: false,
    stderrIncomplete: false,
  }, 'ansi-and-osc');
  assertResult(await projectRealPipe('c1-and-strings'), {
    stdout: 'ABC\n',
    stderr: 'DE\n',
    stdoutIncomplete: false,
    stderrIncomplete: false,
  }, 'c1-and-strings');
  assertResult(await projectRealPipe('incomplete-string'), {
    stdout: 'before\n',
    stderr: 'plain\ttext\\x07\n',
    stdoutIncomplete: true,
    stderrIncomplete: false,
  }, 'incomplete-string');

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
