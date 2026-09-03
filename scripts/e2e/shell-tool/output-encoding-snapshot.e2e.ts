import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';
import type { Writable } from 'node:stream';

import {
  CommandResolvedShellV1Schema,
  type CommandOutputTextEncoding,
  type CommandPipeOutputChannel,
} from '@app/schemas/commands';

import { createPipeCommandTextProjectionSession } from '../../../src/infra/adapters/command-runtime/output';

const CHILD_FLAG = '--output-encoding-snapshot-child';

async function writePieces(
  stream: Writable,
  pieces: readonly Uint8Array[],
): Promise<void> {
  for (const piece of pieces) {
    await new Promise<void>((resolve, reject) => {
      stream.write(piece, error => error ? reject(error) : resolve());
    });
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

async function runChild(encoding: CommandOutputTextEncoding): Promise<void> {
  if (encoding === 'utf-8') {
    await Promise.all([
      writePieces(process.stdout, [
        Uint8Array.of(0xe4),
        Uint8Array.of(0xb8, 0xad, 0xe6),
        Uint8Array.of(0x96, 0x87, 0x0a),
      ]),
      writePieces(process.stderr, [
        Uint8Array.of(0xe9, 0x94),
        Uint8Array.of(0x99, 0xe8, 0xaf, 0xaf),
      ]),
    ]);
    return;
  }

  await Promise.all([
    writePieces(process.stdout, [
      Uint8Array.of(0xd6),
      Uint8Array.of(0xd0, 0xce),
      Uint8Array.of(0xc4, 0x0a),
    ]),
    writePieces(process.stderr, [
      Uint8Array.of(0xb4),
      Uint8Array.of(0xed, 0xce, 0xf3),
    ]),
  ]);
}

function createResolvedShell(encoding: CommandOutputTextEncoding) {
  // CP936 case只验证显式 snapshot -> decoder，不冒充生产 PowerShell profile。
  const windows = process.platform === 'win32' && encoding === 'utf-8';
  return CommandResolvedShellV1Schema.parse({
    platform: windows ? 'windows' : 'macos',
    shell_semantics_id: windows ? 'powershell-5.1' : 'zsh',
    shell_version: windows ? '5.1' : '5.9',
    snapshot_revision: `encoding-e2e-${process.platform}`,
    output_text_encoding: encoding,
    command_invocation_profile_id: windows
      ? 'powershell-utf8-v1'
      : 'plain-v1',
    executable_path: windows
      ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : '/bin/zsh',
    argv_prefix: windows
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']
      : ['-f', '-c'],
  });
}

async function projectChildOutput(
  encoding: CommandOutputTextEncoding,
): Promise<Readonly<Record<CommandPipeOutputChannel, string>>> {
  const shell = createResolvedShell(encoding);
  const entry = process.argv[1];
  if (!entry) throw new Error('output encoding E2E entry path is unavailable');

  const child = spawn(process.execPath, [
    ...process.execArgv,
    entry,
    CHILD_FLAG,
    encoding,
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const session = createPipeCommandTextProjectionSession({
    encoding: shell.output_text_encoding,
    currentLogicalLineLimits: { maxCharactersPerCurrentLine: 100 },
    agentTextProjectionLimits: {
      maxCharactersPerStream: 200,
      maxLinesPerStream: 20,
    },
  });
  const stable: Record<CommandPipeOutputChannel, string[]> = {
    stdout: [],
    stderr: [],
  };

  function accept(channel: CommandPipeOutputChannel, bytes: Buffer): void {
    const delta = session.write(
      channel,
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
    stable[channel].push(delta.stableText);
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
  stable.stdout.push(finalization.trailingStableText.stdout);
  stable.stderr.push(finalization.trailingStableText.stderr);
  return Object.freeze({
    stdout: stable.stdout.join(''),
    stderr: stable.stderr.join(''),
  });
}

async function main(): Promise<void> {
  const childFlagIndex = process.argv.indexOf(CHILD_FLAG);
  if (childFlagIndex !== -1) {
    const encoding = process.argv[childFlagIndex + 1];
    if (encoding !== 'utf-8' && encoding !== 'windows-936') {
      throw new Error(`unknown child encoding: ${String(encoding)}`);
    }
    await runChild(encoding);
    return;
  }

  assert.deepEqual(await projectChildOutput('utf-8'), {
    stdout: '中文\n',
    stderr: '错误',
  });
  assert.deepEqual(await projectChildOutput('windows-936'), {
    stdout: '中文\n',
    stderr: '错误',
  });
  assert.equal(CommandResolvedShellV1Schema.safeParse({
    ...createResolvedShell('utf-8'),
    output_text_encoding: 'auto',
  }).success, false);

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
