import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  CommandOutputArtifactOwnerSchema,
  CommandOutputSequenceSchema,
} from '../../../src/domains/commands/definitions/commandOutputArtifact';
import {
  createFileCommandOutputArtifactPort,
  deriveCommandOutputArtifactRelativePaths,
  type CommandOutputArtifactFileOperations,
  type CommandOutputArtifactWritableFile,
} from '../../../src/infra/adapters/command-runtime/output';

const runRoot = await fsp.mkdtemp(
  path.join(os.tmpdir(), 'linnya-command-output-e2e-中文 path-'),
);
let succeeded = false;

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise?.() };
}

function createOwner(executionSuffix: string) {
  return CommandOutputArtifactOwnerSchema.parse({
    identity: {
      conversation_id: 'e2e/artifact-conversation',
      agent_run_id: 'e2e-artifact-run',
      origin_tool_call_id: 'e2e-artifact-tool-call',
      command_execution_id: `command_execution_20000000-0000-4000-8000-0000000000${executionSuffix}`,
      owner_generation_id: 'command_owner_20000000-0000-4000-8000-000000000099',
      created_at_ms: 1_785_499_200_000,
    },
    instance_id: 'default',
  });
}

function createRealFileOperations(): CommandOutputArtifactFileOperations {
  return {
    async ensureDirectory(directoryPath) {
      await fsp.mkdir(directoryPath, { recursive: true });
    },
    async createDirectory(directoryPath) {
      await fsp.mkdir(directoryPath);
    },
    async openExclusive(filePath): Promise<CommandOutputArtifactWritableFile> {
      const handle = await fsp.open(filePath, 'wx');
      return {
        async write(bytes, offset, length, position) {
          const result = await handle.write(bytes, offset, length, position);
          return { bytesWritten: result.bytesWritten };
        },
        async sync() {
          await handle.sync();
        },
        async close() {
          await handle.close();
        },
      };
    },
    async rename(sourcePath, destinationPath) {
      await fsp.rename(sourcePath, destinationPath);
    },
    async removeFile(filePath) {
      await fsp.unlink(filePath);
    },
    async removeDirectory(directoryPath) {
      await fsp.rm(directoryPath, { recursive: true, force: true });
    },
  };
}

function executionDirectory(owner: ReturnType<typeof createOwner>, mode: 'pipe' | 'pty') {
  return path.join(
    runRoot,
    ...deriveCommandOutputArtifactRelativePaths(owner, mode).directorySegments,
  );
}

try {
  const normalOwner = createOwner('01');
  const normalPort = createFileCommandOutputArtifactPort({ storageRoot: runRoot });
  const normal = await normalPort.open({ owner: normalOwner, mode: 'pipe' });
  assert.equal(normal.status, 'opened');
  if (normal.status !== 'opened') throw new Error('normal writer unavailable');
  const stdout = Uint8Array.from([0, 255, 65, 10]);
  const stderr = new TextEncoder().encode('错误流\n');
  assert.equal(normal.writer.append({
      mode: 'pipe',
      channel: 'stdout',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: stdout,
    }).status, 'accepted');
  assert.equal(normal.writer.append({
      mode: 'pipe',
      channel: 'stderr',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: stderr,
    }).status, 'accepted');
  const normalFinal = await normal.writer.finalize({
    sealedAtMs: 1_785_499_201_000,
    retentionUntilMs: 1_786_104_001_000,
    source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
  });
  assert.equal(normalFinal.status, 'manifest_persisted');
  assert.deepEqual(
    await fsp.readFile(path.join(executionDirectory(normalOwner, 'pipe'), 'stdout.bin')),
    Buffer.from(stdout),
  );
  assert.deepEqual(
    await fsp.readFile(path.join(executionDirectory(normalOwner, 'pipe'), 'stderr.bin')),
    Buffer.from(stderr),
  );

  const collisionOwner = createOwner('02');
  const first = await normalPort.open({ owner: collisionOwner, mode: 'pipe' });
  assert.equal(first.status, 'opened');
  if (first.status !== 'opened') throw new Error('collision owner unavailable');
  const duplicate = await normalPort.open({ owner: collisionOwner, mode: 'pipe' });
  assert.equal(duplicate.status, 'unavailable');
  assert.equal(
    duplicate.status === 'unavailable' && duplicate.failure.code,
    'path_unavailable',
  );
  assert.equal(first.writer.append({
    mode: 'pipe',
    channel: 'stdout',
    sequence: CommandOutputSequenceSchema.parse(0),
    bytes: new TextEncoder().encode('owner-still-alive'),
  }).status, 'accepted');
  await first.writer.finalize({
    sealedAtMs: 20,
    retentionUntilMs: 30,
    source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
  });
  assert.equal(
    await fsp.readFile(path.join(executionDirectory(collisionOwner, 'pipe'), 'stdout.bin'), 'utf8'),
    'owner-still-alive',
  );

  const real = createRealFileOperations();
  let binaryWriteCount = 0;
  const failureOperations: CommandOutputArtifactFileOperations = {
    ...real,
    async openExclusive(filePath) {
      const file = await real.openExclusive(filePath);
      if (!filePath.endsWith('.bin')) return file;
      return {
        ...file,
        async write(bytes, offset, length, position) {
          binaryWriteCount += 1;
          if (binaryWriteCount === 2) {
            throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
          }
          return file.write(bytes, offset, length, position);
        },
      };
    },
  };
  const failureOwner = createOwner('03');
  const failurePort = createFileCommandOutputArtifactPort({
    storageRoot: runRoot,
    operations: failureOperations,
    now: () => 100,
  });
  const failure = await failurePort.open({ owner: failureOwner, mode: 'pipe' });
  assert.equal(failure.status, 'opened');
  if (failure.status !== 'opened') throw new Error('failure writer unavailable');
  assert.equal(failure.writer.append({
    mode: 'pipe',
    channel: 'stdout',
    sequence: CommandOutputSequenceSchema.parse(0),
    bytes: new TextEncoder().encode('saved'),
  }).status, 'accepted');
  assert.equal(failure.writer.append({
    mode: 'pipe',
    channel: 'stdout',
    sequence: CommandOutputSequenceSchema.parse(1),
    bytes: new TextEncoder().encode('not-saved'),
  }).status, 'accepted');
  assert.equal(failure.writer.append({
    mode: 'pipe',
    channel: 'stderr',
    sequence: CommandOutputSequenceSchema.parse(0),
    bytes: new TextEncoder().encode('observed-only'),
  }).status, 'accepted');
  const failureFinal = await failure.writer.finalize({
    sealedAtMs: 200,
    retentionUntilMs: 300,
    source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
  });
  assert.equal(failureFinal.status, 'manifest_persisted');
  assert.equal(binaryWriteCount, 2);
  assert.equal(
    failureFinal.manifest.mode === 'pipe' && failureFinal.manifest.stdout.status,
    'incomplete',
  );
  assert.equal(
    failureFinal.manifest.mode === 'pipe' && failureFinal.manifest.stderr.status,
    'incomplete',
  );

  const manifestOwner = createOwner('04');
  const manifestOperations: CommandOutputArtifactFileOperations = {
    ...real,
    async rename(sourcePath, destinationPath) {
      if (destinationPath.endsWith('manifest.json')) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
      await real.rename(sourcePath, destinationPath);
    },
  };
  const manifestPort = createFileCommandOutputArtifactPort({
    storageRoot: runRoot,
    operations: manifestOperations,
    now: () => 400,
  });
  const manifestWriter = await manifestPort.open({ owner: manifestOwner, mode: 'pty' });
  assert.equal(manifestWriter.status, 'opened');
  if (manifestWriter.status !== 'opened') throw new Error('manifest writer unavailable');
  assert.equal(manifestWriter.writer.append({
    mode: 'pty',
    channel: 'terminal',
    sequence: CommandOutputSequenceSchema.parse(0),
    bytes: new TextEncoder().encode('terminal'),
  }).status, 'accepted');
  const manifestFinal = await manifestWriter.writer.finalize({
    sealedAtMs: 500,
    retentionUntilMs: 600,
    source: { mode: 'pty', terminal: 'complete' },
  });
  assert.equal(manifestFinal.status, 'manifest_unavailable');
  assert.equal(
    manifestFinal.status === 'manifest_unavailable' && manifestFinal.failure.code,
    'permission_denied',
  );

  const interruptedOwner = createOwner('05');
  const interrupted = await normalPort.open({ owner: interruptedOwner, mode: 'pipe' });
  assert.equal(interrupted.status, 'opened');
  if (interrupted.status !== 'opened') throw new Error('interrupted writer unavailable');
  const partial = new TextEncoder().encode('runner-crash-partial');
  assert.equal(interrupted.writer.append({
    mode: 'pipe',
    channel: 'stdout',
    sequence: CommandOutputSequenceSchema.parse(0),
    bytes: partial,
  }).status, 'accepted');
  const interruptedFinal = await interrupted.writer.finalize({
    sealedAtMs: 700,
    retentionUntilMs: 800,
    source: { mode: 'pipe', stdout: 'interrupted', stderr: 'complete' },
  });
  assert.equal(interruptedFinal.status, 'manifest_persisted');
  assert.equal(
    interruptedFinal.manifest.mode === 'pipe'
      && interruptedFinal.manifest.stdout.status,
    'incomplete',
  );
  assert.equal(
    interruptedFinal.manifest.mode === 'pipe'
      && interruptedFinal.manifest.stdout.source_completion,
    'interrupted',
  );

  const backpressureOwner = createOwner('06');
  const writeEntered = deferred();
  const releaseWrite = deferred();
  let slowWriteCount = 0;
  const slowOperations: CommandOutputArtifactFileOperations = {
    ...real,
    async openExclusive(filePath) {
      const file = await real.openExclusive(filePath);
      if (!filePath.endsWith('.bin')) return file;
      return {
        ...file,
        async write(bytes, offset, length, position) {
          slowWriteCount += 1;
          if (slowWriteCount === 1) {
            writeEntered.resolve();
            await releaseWrite.promise;
          }
          return file.write(bytes, offset, length, position);
        },
      };
    },
  };
  const backpressurePort = createFileCommandOutputArtifactPort({
    storageRoot: runRoot,
    operations: slowOperations,
    now: () => 900,
    writerLimits: { maxPendingEvents: 2, maxPendingBytes: 64 },
  });
  const backpressure = await backpressurePort.open({
    owner: backpressureOwner,
    mode: 'pipe',
  });
  assert.equal(backpressure.status, 'opened');
  if (backpressure.status !== 'opened') throw new Error('backpressure writer unavailable');
  const callerOwned = Uint8Array.from([1]);
  assert.equal(backpressure.writer.append({
    mode: 'pipe',
    channel: 'stdout',
    sequence: CommandOutputSequenceSchema.parse(0),
    bytes: callerOwned,
  }).status, 'accepted');
  callerOwned[0] = 9;
  await writeEntered.promise;
  assert.equal(backpressure.writer.append({
    mode: 'pipe',
    channel: 'stderr',
    sequence: CommandOutputSequenceSchema.parse(0),
    bytes: Uint8Array.from([2]),
  }).status, 'accepted');
  const overloaded = backpressure.writer.append({
    mode: 'pipe',
    channel: 'stdout',
    sequence: CommandOutputSequenceSchema.parse(1),
    bytes: Uint8Array.from([3]),
  });
  assert.deepEqual(overloaded, {
    status: 'disabled',
    firstFailureCode: 'sink_overloaded',
  });
  assert.equal(slowWriteCount, 1);

  const backpressureFinalPromise = backpressure.writer.finalize({
    sealedAtMs: 1_000,
    retentionUntilMs: 1_100,
    source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
  });
  assert.equal(await Promise.race([
    backpressureFinalPromise.then(() => 'finalized'),
    Promise.resolve('pending'),
  ]), 'pending');
  releaseWrite.resolve();
  const backpressureFinal = await backpressureFinalPromise;
  assert.equal(backpressureFinal.status, 'manifest_persisted');
  assert.equal(slowWriteCount, 2);
  assert.equal(
    backpressureFinal.manifest.mode === 'pipe'
      && backpressureFinal.manifest.stdout.first_error?.code,
    'sink_overloaded',
  );
  assert.deepEqual(
    await fsp.readFile(path.join(executionDirectory(backpressureOwner, 'pipe'), 'stdout.bin')),
    Buffer.from([1]),
  );

  // Windows 只有在两个文件句柄都真实关闭后才能删除目录；该场景同时验证平台顺序。
  const discardOwner = createOwner('07');
  const discard = await normalPort.open({ owner: discardOwner, mode: 'pipe' });
  assert.equal(discard.status, 'opened');
  if (discard.status !== 'opened') throw new Error('discard writer unavailable');
  const discarded = await discard.writer.discardBeforeSourceStart();
  assert.deepEqual(discarded, { status: 'discarded' });
  await assert.rejects(
    fsp.stat(executionDirectory(discardOwner, 'pipe')),
    (error: unknown) => (
      typeof error === 'object'
      && error !== null
      && 'code' in error
      && error.code === 'ENOENT'
    ),
  );

  succeeded = true;
  process.stdout.write(`${JSON.stringify({
    ok: true,
    platform: process.platform,
    cases: 7,
  })}\n`);
} finally {
  if (succeeded) {
    await fsp.rm(runRoot, { recursive: true, force: true });
  } else {
    process.stderr.write(`command output artifact harness failed; evidence preserved at ${runRoot}\n`);
  }
}
