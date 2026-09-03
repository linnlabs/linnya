import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';

import {
  CommandResolvedShellV1Schema,
  type CommandPipeOutputChannel,
} from '@app/schemas/commands';

import { createPipeCommandTextProjectionSession } from '../../../src/infra/adapters/command-runtime/output';
import { resolveCommandInvocationArguments } from '../../../src/infra/adapters/command-runtime/runner/functions/resolveCommandInvocationArguments';

interface InvocationResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly raw: Readonly<Record<CommandPipeOutputChannel, Uint8Array>>;
  readonly text: Readonly<Record<CommandPipeOutputChannel, string>>;
}

function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function createShell() {
  const windows = process.platform === 'win32';
  return CommandResolvedShellV1Schema.parse({
    platform: windows ? 'windows' : 'macos',
    shell_semantics_id: windows ? 'powershell-5.1' : 'zsh',
    shell_version: windows ? '5.1' : '5.9',
    snapshot_revision: `invocation-profile-e2e-${process.platform}`,
    output_text_encoding: 'utf-8',
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

async function runCommand(command: string): Promise<InvocationResult> {
  const shell = createShell();
  const child = spawn(shell.executable_path, [
    ...shell.argv_prefix,
    ...resolveCommandInvocationArguments({ shell, approvedCommand: command }),
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const projection = createPipeCommandTextProjectionSession({
    encoding: shell.output_text_encoding,
    currentLogicalLineLimits: { maxCharactersPerCurrentLine: 1_000 },
    agentTextProjectionLimits: {
      maxCharactersPerStream: 4_000,
      maxLinesPerStream: 100,
    },
  });
  const raw: Record<CommandPipeOutputChannel, Buffer[]> = {
    stdout: [],
    stderr: [],
  };
  const stable: Record<CommandPipeOutputChannel, string[]> = {
    stdout: [],
    stderr: [],
  };

  function accept(channel: CommandPipeOutputChannel, bytes: Buffer): void {
    raw[channel].push(Buffer.from(bytes));
    stable[channel].push(projection.write(
      channel,
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    ).stableText);
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
  const finalized = projection.finalize();
  stable.stdout.push(finalized.trailingStableText.stdout);
  stable.stderr.push(finalized.trailingStableText.stderr);

  return Object.freeze({
    ...terminal,
    raw: Object.freeze({
      stdout: Buffer.concat(raw.stdout),
      stderr: Buffer.concat(raw.stderr),
    }),
    text: Object.freeze({
      stdout: stable.stdout.join(''),
      stderr: stable.stderr.join(''),
    }),
  });
}

async function runWindowsCases(): Promise<number> {
  const mixed = await runCommand([
    "Write-Output 'PS中文'",
    "[Console]::Error.WriteLine('PS错误')",
    `& ${quotePowerShellLiteral(process.execPath)} -e "process.stdout.write('NODE中文\\n');process.stderr.write('NODE错误\\n')"`,
    'cmd.exe /d /s /c "echo CMD中文 & echo CMD错误 1>&2"',
    'exit 7',
  ].join('\n'));
  assert.equal(mixed.exitCode, 7);
  assert.equal(mixed.signal, null);
  assert.match(mixed.text.stdout, /PS中文/);
  assert.match(mixed.text.stdout, /NODE中文/);
  assert.match(mixed.text.stdout, /CMD中文/);
  assert.match(mixed.text.stderr, /PS错误/);
  assert.match(mixed.text.stderr, /NODE错误/);
  assert.match(mixed.text.stderr, /CMD错误/);
  assert.notEqual(
    Buffer.from(mixed.raw.stdout).indexOf(Buffer.from('PS中文', 'utf8')),
    -1,
  );

  const comment = await runCommand("# first line comment\nWrite-Output 'comment中文'; exit 7");
  assert.equal(comment.exitCode, 7);
  assert.equal(comment.text.stdout, 'comment中文\n');

  const requiresAndReturn = await runCommand([
    '#requires -Version 5.1',
    "Write-Output 'before中文'",
    'return',
    "Write-Output 'after'",
  ].join('\n'));
  assert.equal(requiresAndReturn.exitCode, 0);
  assert.equal(requiresAndReturn.text.stdout, 'before中文\n');

  const lastExitCode = await runCommand([
    'cmd.exe /d /s /c "exit /b 7"',
    'Write-Output "last:$LASTEXITCODE"',
    'exit $LASTEXITCODE',
  ].join('\n'));
  assert.equal(lastExitCode.exitCode, 7);
  assert.equal(lastExitCode.text.stdout, 'last:7\n');
  return 4;
}

async function runMacOsCases(): Promise<number> {
  const comment = await runCommand("# first line comment\nprintf 'comment:中文\\n'; exit 7");
  assert.equal(comment.exitCode, 7);
  assert.equal(comment.text.stdout, 'comment:中文\n');

  const dualStream = await runCommand(
    "printf 'stdout:中文\\n'; printf 'stderr:错误\\n' >&2",
  );
  assert.equal(dualStream.exitCode, 0);
  assert.equal(dualStream.text.stdout, 'stdout:中文\n');
  assert.equal(dualStream.text.stderr, 'stderr:错误\n');
  return 2;
}

async function main(): Promise<void> {
  const cases = process.platform === 'win32'
    ? await runWindowsCases()
    : await runMacOsCases();
  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cases,
  })}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
