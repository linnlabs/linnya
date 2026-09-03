import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import type { Writable } from 'node:stream';

import type {
  CommandOutputTextEncoding,
  CommandPipeOutputChannel,
} from '@app/schemas/commands';
import {
  createPipeCommandTextProjectionSession,
  type PipeCommandTextProjectionFinalization,
} from '../../../src/infra/adapters/command-runtime/output';

const CHILD_FLAG = '--pipe-text-projection-child';

type E2eCaseName = 'utf8-progress' | 'cp936-streams' | 'bounded-and-incomplete';

interface ProjectedRealPipe {
  readonly stableText: Readonly<Record<CommandPipeOutputChannel, string>>;
  readonly finalization: PipeCommandTextProjectionFinalization;
}

async function writePieces(
  stream: Writable,
  pieces: readonly (string | Uint8Array)[],
): Promise<void> {
  for (const piece of pieces) {
    await new Promise<void>((resolve, reject) => {
      stream.write(piece, error => {
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

async function runChild(caseName: E2eCaseName): Promise<void> {
  switch (caseName) {
    case 'utf8-progress':
      await Promise.all([
        writePieces(process.stdout, [
          'start\n10%', '\r20%\r', '100%\r\n', 'tail🙂',
        ]),
        writePieces(process.stderr, [
          'warn\u001b[31m!\u001b[0m\n', '\u001b]0;ignored\u0007done',
        ]),
      ]);
      return;
    case 'cp936-streams':
      await Promise.all([
        // “中文\r完成\n”的固定 CP936 byte，不用同一个 encoder 自证 decoder。
        writePieces(process.stdout, [
          Uint8Array.of(0xd6),
          Uint8Array.of(0xd0, 0xce),
          Uint8Array.of(0xc4, 0x0d, 0xcd),
          Uint8Array.of(0xea, 0xb3, 0xc9, 0x0a),
        ]),
        // “错误”的固定 CP936 byte；与 stdout 半字符交错，验证两流状态隔离。
        writePieces(process.stderr, [
          Uint8Array.of(0xb4),
          Uint8Array.of(0xed, 0xce),
          Uint8Array.of(0xf3),
        ]),
      ]);
      return;
    case 'bounded-and-incomplete':
      await Promise.all([
        writePieces(process.stdout, [
          'x'.repeat(1024 * 1024), '\r', 'done\n', '\u001b]0;', 'hidden'.repeat(1000),
        ]),
        writePieces(process.stderr, [
          `HEAD${'y'.repeat(1024 * 1024)}TAIL`,
        ]),
      ]);
      return;
  }
}

async function projectRealPipe(
  caseName: E2eCaseName,
  encoding: CommandOutputTextEncoding,
): Promise<ProjectedRealPipe> {
  const currentEntry = process.argv[1];
  if (!currentEntry) throw new Error('pipe text projection E2E entry path is unavailable');
  // 源码态继承 tsx loader，CommonJS bundle 态 execArgv 为空，两种入口走同一 child 合同。
  const child = spawn(process.execPath, [
    ...process.execArgv,
    currentEntry,
    CHILD_FLAG,
    caseName,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const session = createPipeCommandTextProjectionSession({
    encoding,
    currentLogicalLineLimits: { maxCharactersPerCurrentLine: 20 },
    agentTextProjectionLimits: {
      maxCharactersPerStream: 80,
      maxLinesPerStream: 20,
    },
  });
  const stableText: Record<CommandPipeOutputChannel, string[]> = {
    stdout: [],
    stderr: [],
  };

  function accept(channel: CommandPipeOutputChannel, bytes: Buffer): void {
    const delta = session.write(
      channel,
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
    stableText[channel].push(delta.stableText);
  }

  child.stdout.on('data', (bytes: Buffer) => accept('stdout', bytes));
  child.stderr.on('data', (bytes: Buffer) => accept('stderr', bytes));
  const terminal = await new Promise<{
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ exitCode, signal }));
  });
  assert.deepEqual(terminal, { exitCode: 0, signal: null });

  const finalization = session.finalize();
  stableText.stdout.push(finalization.trailingStableText.stdout);
  stableText.stderr.push(finalization.trailingStableText.stderr);
  return Object.freeze({
    stableText: Object.freeze({
      stdout: stableText.stdout.join(''),
      stderr: stableText.stderr.join(''),
    }),
    finalization,
  });
}

async function main(): Promise<void> {
  const childFlagIndex = process.argv.indexOf(CHILD_FLAG);
  if (childFlagIndex !== -1) {
    const caseName = process.argv[childFlagIndex + 1];
    if (
      caseName !== 'utf8-progress'
      && caseName !== 'cp936-streams'
      && caseName !== 'bounded-and-incomplete'
    ) {
      throw new Error(`unknown child case: ${String(caseName)}`);
    }
    await runChild(caseName);
    return;
  }

  const utf8 = await projectRealPipe('utf8-progress', 'utf-8');
  assert.deepEqual(utf8.stableText, {
    stdout: 'start\n100%\ntail🙂',
    stderr: 'warn!\ndone',
  });
  assert.deepEqual(utf8.finalization.streams, {
    stdout: {
      incompleteControlSequenceOmitted: false,
      logicalLinesWithOmissions: 0,
      logicalLineOmittedCharacters: 0,
    },
    stderr: {
      incompleteControlSequenceOmitted: false,
      logicalLinesWithOmissions: 0,
      logicalLineOmittedCharacters: 0,
    },
  });

  const cp936 = await projectRealPipe('cp936-streams', 'windows-936');
  assert.deepEqual(cp936.stableText, {
    stdout: '完成\n',
    stderr: '错误',
  });

  const bounded = await projectRealPipe('bounded-and-incomplete', 'utf-8');
  assert.equal(bounded.stableText.stdout, 'done\n');
  assert.equal(
    bounded.stableText.stderr,
    `HEAD${'y'.repeat(6)}[... output omitted ...]${'y'.repeat(6)}TAIL`,
  );
  assert.equal(
    bounded.finalization.streams.stdout.incompleteControlSequenceOmitted,
    true,
  );
  assert.deepEqual(bounded.finalization.streams.stderr, {
    incompleteControlSequenceOmitted: false,
    logicalLinesWithOmissions: 1,
    logicalLineOmittedCharacters: 1024 * 1024 - 12,
  });

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
