import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import { createWindowsJobOwnedPtyCommandProcessLauncher } from '../../../../../src/infra/adapters/command-runtime/windows/createWindowsJobOwnedPtyCommandProcess';
import { createWindowsOwnedPtyNativeBindingLoader } from '../../../../../src/infra/adapters/command-runtime/windows/functions/loadWindowsOwnedPtyNativeBinding';
import type { OwnedPtyCommandProcess } from '../../../../../src/infra/adapters/command-runtime/runner/definitions/ownedPtyCommandProcess';

const TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超过 ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    void promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function waitForOutput(output: () => Buffer, marker: string): Promise<void> {
  await withTimeout((async () => {
    const expected = Buffer.from(marker);
    while (!output().includes(expected)) await delay(10);
  })(), `正式 adapter 输出 ${marker}`);
}

function launchInput(fixturePath: string, mode: string, suiteRoot: string) {
  return {
    executablePath: process.execPath,
    argv: [fixturePath, mode],
    cwd: suiteRoot,
    environment: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => (
        typeof entry[1] === 'string'
      )),
    ),
    terminalSize: { columns: 80, rows: 24 },
  };
}

function launchResizeProbe(suiteRoot: string) {
  const source = [
    "$ErrorActionPreference = 'Stop'",
    '[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)',
    '[Console]::WriteLine(("SIZE_BEFORE:{0}x{1}" -f [Console]::WindowWidth, [Console]::WindowHeight))',
    '[void][Console]::ReadLine()',
    'Start-Sleep -Milliseconds 100',
    '[Console]::WriteLine(("SIZE_AFTER:{0}x{1}" -f [Console]::WindowWidth, [Console]::WindowHeight))',
    'exit 21',
  ].join('\n');
  return {
    ...launchInput('', '', suiteRoot),
    executablePath: path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    argv: [
      '-NoLogo',
      '-NoProfile',
      '-EncodedCommand',
      Buffer.from(source, 'utf16le').toString('base64'),
    ],
  };
}

function collectTerminal(owner: OwnedPtyCommandProcess): {
  readonly output: () => Buffer;
  readonly closed: Promise<void>;
} {
  const chunks: Buffer[] = [];
  owner.terminal.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  const closed = new Promise<void>((resolve, reject) => {
    owner.terminal.once('end', resolve);
    owner.terminal.once('error', reject);
  });
  return { output: () => Buffer.concat(chunks), closed };
}

async function settle(
  owner: OwnedPtyCommandProcess,
  terminalClosed: Promise<void>,
  expectedExitCode: number,
): Promise<void> {
  const rootExit = await withTimeout(owner.rootExit, '正式 adapter root exit');
  assert.equal(rootExit.exitCode, expectedExitCode);
  assert.deepEqual(await withTimeout(
    owner.stopAndWaitForTreeEmpty(),
    '正式 adapter tree empty',
  ), { status: 'succeeded' });
  const [release] = await withTimeout(Promise.all([
    owner.release(),
    terminalClosed,
  ]), '正式 adapter release + terminal EOF');
  assert.deepEqual(release, { status: 'succeeded' });
}

async function run(): Promise<void> {
  const [manifestPath, fixturePath, suiteRoot, runtimeVersion, applicationVersion, architecture] =
    process.argv.slice(2);
  assert(manifestPath && fixturePath && suiteRoot && runtimeVersion && applicationVersion);
  assert.equal(process.arch, architecture);
  await mkdir(suiteRoot, { recursive: true });

  const binding = await createWindowsOwnedPtyNativeBindingLoader({
    manifestPath,
    expectedRuntimeVersion: runtimeVersion,
    expectedApplicationVersion: applicationVersion,
    trust: { kind: 'development' },
  }).load();
  const launch = createWindowsJobOwnedPtyCommandProcessLauncher(binding);

  const inputOwner = await launch(launchInput(fixturePath, '--quiet-input', suiteRoot));
  const inputTerminal = collectTerminal(inputOwner);
  await inputOwner.interact({ type: 'write', input: 'production中文' });
  await inputOwner.interact({ type: 'submit', input: '' });
  await settle(inputOwner, inputTerminal.closed, 17);
  assert(inputTerminal.output().includes(Buffer.from('production中文', 'utf8')));

  const eofOwner = await launch(launchInput(fixturePath, '--wait-eof', suiteRoot));
  const eofTerminal = collectTerminal(eofOwner);
  await eofOwner.interact({ type: 'eof' });
  await delay(100);
  assert.deepEqual(await eofOwner.stopAndWaitForTreeEmpty(), { status: 'succeeded' });
  const eofExit = await eofOwner.rootExit;
  assert.equal(eofExit.exitCode, 1);
  assert.deepEqual(await eofOwner.release(), { status: 'succeeded' });
  await eofTerminal.closed;
  assert(eofTerminal.output().includes(Buffer.from('^Z')));

  const resizeOwner = await launch(launchResizeProbe(suiteRoot));
  const resizeTerminal = collectTerminal(resizeOwner);
  await waitForOutput(resizeTerminal.output, 'SIZE_BEFORE:');
  await resizeOwner.interact({ type: 'resize', columns: 123, rows: 45 });
  await resizeOwner.interact({ type: 'submit', input: '' });
  await settle(resizeOwner, resizeTerminal.closed, 21);
  assert.match(resizeTerminal.output().toString('utf8'), /SIZE_AFTER:123x45/u);

  const outputOwner = await launch(launchInput(fixturePath, '--large-output', suiteRoot));
  await delay(200);
  const outputTerminal = collectTerminal(outputOwner);
  await settle(outputOwner, outputTerminal.closed, 29);
  const output = outputTerminal.output();
  assert(output.includes(Buffer.from('BEGIN_16M')));
  assert(output.includes(Buffer.from('END_16M')));
  assert(output.byteLength >= 16 * 1024 * 1024);

  process.stdout.write(`${JSON.stringify({
    success: true,
    architecture,
    productionAdapter: true,
    outputBytes: output.byteLength,
  })}\n`);
}

void run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
