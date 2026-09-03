import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const runtimeArchitecture = process.arch;
const nodeExecutable = path.join(
  repositoryRoot,
  'extraResources',
  'headless-node-runtime',
  process.platform,
  runtimeArchitecture,
  process.platform === 'win32' ? 'node.exe' : 'bin/node',
);
const evaluatorBundle = path.join(
  repositoryRoot,
  'dist/main/sandbox/sandboxEvaluatorProcess.cjs',
);

async function runEvaluator(runDirectory, runToken, maximumHeapMb) {
  const child = spawn(nodeExecutable, [
    `--max-old-space-size=${maximumHeapMb}`,
    evaluatorBundle,
    '1',
    runToken,
    String(maximumHeapMb),
  ], {
    cwd: runDirectory,
    env: {},
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on('data', chunk => { stdoutChunks.push(Buffer.from(chunk)); });
  child.stderr.on('data', chunk => { stderrChunks.push(Buffer.from(chunk)); });
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return {
    ...exit,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8'),
  };
}

async function main() {
  const runDirectory = await mkdtemp(path.join(os.tmpdir(), 'linnya-sandbox-evaluator-'));
  const mismatchDirectory = await mkdtemp(path.join(os.tmpdir(), 'linnya-sandbox-evaluator-'));
  const runToken = randomBytes(16).toString('hex');
  try {
    const manifest = JSON.parse(await readFile(path.join(
      repositoryRoot,
      'extraResources',
      'headless-node-runtime',
      process.platform,
      runtimeArchitecture,
      'runtime-manifest.json',
    ), 'utf8'));
    assert.equal(manifest.node_version, '24.18.1');
    assert.equal(manifest.platform, process.platform);
    assert.equal(manifest.architecture, runtimeArchitecture);
    assert.equal(nodeExecutable.includes('.app/'), false);

    const requestEnvelope = {
      protocol_version: 1,
      kind: 'sandbox_request',
      run_token: runToken,
      request: {
        runId: 'headless-evaluator-e2e',
        profileId: 'default',
        language: 'javascript',
        source: 'console.log("evaluator 中文"); return { ok: true };',
        globals: {},
        bindings: [],
        limits: {
          timeoutMs: 10_000,
          maxLogLines: 20,
          maxLogLineLength: 2_000,
          maxResultBytes: 256 * 1024,
          maxSourceBytes: 128 * 1024,
          maxCapabilityPayloadBytes: 256 * 1024,
          maxHeapMb: 64,
          idleTimeoutMs: 12_000,
        },
        capabilities: [],
      },
    };
    await writeFile(
      path.join(runDirectory, 'request.json'),
      JSON.stringify(requestEnvelope),
      { mode: 0o600 },
    );

    const result = await runEvaluator(runDirectory, runToken, 64);
    assert.deepEqual({ code: result.code, signal: result.signal }, { code: 0, signal: null });
    assert.equal(result.stderr, '');
    const frames = result.stdout.trimEnd().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(frames.map(frame => frame.kind), ['ready', 'started', 'result_committed']);
    assert(frames.every(frame => frame.run_token === runToken));
    assert(frames.every(frame => frame.pid === frames[0].pid));

    const envelope = JSON.parse(await readFile(path.join(runDirectory, 'result.json'), 'utf8'));
    assert.equal(envelope.run_token, runToken);
    assert.equal(envelope.result.success, true);
    assert.deepEqual(envelope.result.value, { ok: true });
    assert.deepEqual(envelope.result.logs, ['evaluator 中文']);
    assert.equal('stderr' in envelope.result, false);
    assert.equal('diagnostics' in envelope.result, false);

    await writeFile(
      path.join(mismatchDirectory, 'request.json'),
      JSON.stringify(requestEnvelope),
      { mode: 0o600 },
    );
    const mismatch = await runEvaluator(mismatchDirectory, runToken, 128);
    assert.deepEqual({ code: mismatch.code, signal: mismatch.signal }, { code: 1, signal: null });
    assert.match(mismatch.stderr, /^sandbox\.evaluator\.failure:heap_limit_mismatch\n$/u);
    assert.deepEqual(mismatch.stdout.trimEnd().split('\n').map(line => JSON.parse(line).kind), [
      'ready',
    ]);
    await assert.rejects(access(path.join(mismatchDirectory, 'result.json')),
      error => error?.code === 'ENOENT');

    process.stdout.write(`${JSON.stringify({
      success: true,
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: manifest.node_version,
      evaluatorPid: frames[0].pid,
      controlFrames: frames.map(frame => frame.kind),
      resultKind: 'evaluation_only',
      maximumHeapMb: 64,
      headlessNodeRuntime: true,
      mismatchedHeapRejectedBeforeEvaluation: true,
    }, null, 2)}\n`);
  } finally {
    await Promise.all([runDirectory, mismatchDirectory].map(directory => (
      rm(directory, { recursive: true, force: true })
    )));
  }
}

await main();
