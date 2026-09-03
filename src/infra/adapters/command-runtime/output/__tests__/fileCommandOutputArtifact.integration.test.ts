import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CommandOutputArtifactOwnerSchema,
  CommandOutputSequenceSchema,
  parseCommandOutputArtifactManifest,
} from '../../../../../domains/commands/definitions/commandOutputArtifact';
import type {
  CommandOutputArtifactFileOperations,
  CommandOutputArtifactWritableFile,
} from '../createFileCommandOutputArtifactPort';
import {
  classifyCommandOutputArtifactStorageError,
  createFileCommandOutputArtifactPort,
} from '../createFileCommandOutputArtifactPort';
import { deriveCommandOutputArtifactRelativePaths } from '../functions/deriveCommandOutputArtifactRelativePaths';

const EXECUTION_ID = 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a';
const OWNER_GENERATION_ID = 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b';
const temporaryRoots: string[] = [];

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>(resolve => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve() {
      resolvePromise?.();
    },
  };
}

function createOwner() {
  return CommandOutputArtifactOwnerSchema.parse({
    identity: {
      conversation_id: 'conversation/artifact-test',
      agent_run_id: 'run-a',
      origin_tool_call_id: 'shell-call-a',
      command_execution_id: EXECUTION_ID,
      owner_generation_id: OWNER_GENERATION_ID,
      created_at_ms: 1_785_499_200_000,
    },
    instance_id: 'default',
  });
}

async function createStorageRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-command-output-'));
  temporaryRoots.push(root);
  return root;
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

function artifactPaths(storageRoot: string, mode: 'pipe' | 'pty') {
  const relative = deriveCommandOutputArtifactRelativePaths(createOwner(), mode);
  const directory = path.join(storageRoot, ...relative.directorySegments);
  return {
    directory,
    manifest: path.join(directory, relative.manifestFileName),
    stdout: path.join(directory, 'stdout.bin'),
    stderr: path.join(directory, 'stderr.bin'),
    terminal: path.join(directory, 'terminal.bin'),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

describe('file command output artifact port', () => {
  it('并发追加 pipe 双流后保留原始 byte、各自顺序、hash 和原子 manifest', async () => {
    const storageRoot = await createStorageRoot();
    const port = createFileCommandOutputArtifactPort({
      storageRoot,
      now: () => 1_785_499_200_500,
    });
    const opened = await port.open({ owner: createOwner(), mode: 'pipe' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    const stdoutA = Uint8Array.from([0, 255, 65]);
    const stdoutB = new TextEncoder().encode('尾部');
    const stderr = new TextEncoder().encode('stderr\n');
    const results = [
      opened.writer.append({
        mode: 'pipe',
        channel: 'stdout',
        sequence: CommandOutputSequenceSchema.parse(0),
        bytes: stdoutA,
      }),
      opened.writer.append({
        mode: 'pipe',
        channel: 'stderr',
        sequence: CommandOutputSequenceSchema.parse(0),
        bytes: stderr,
      }),
      opened.writer.append({
        mode: 'pipe',
        channel: 'stdout',
        sequence: CommandOutputSequenceSchema.parse(1),
        bytes: stdoutB,
      }),
    ];
    expect(results.every(result => result.status === 'accepted')).toBe(true);

    const finalized = await opened.writer.finalize({
      sealedAtMs: 1_785_499_201_000,
      retentionUntilMs: 1_786_104_001_000,
      source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
    });
    expect(finalized.status).toBe('manifest_persisted');

    const paths = artifactPaths(storageRoot, 'pipe');
    const expectedStdout = Buffer.concat([Buffer.from(stdoutA), Buffer.from(stdoutB)]);
    await expect(fsp.readFile(paths.stdout)).resolves.toEqual(expectedStdout);
    await expect(fsp.readFile(paths.stderr)).resolves.toEqual(Buffer.from(stderr));
    const manifest = parseCommandOutputArtifactManifest(
      JSON.parse(await fsp.readFile(paths.manifest, 'utf8')) as unknown,
    );
    expect(manifest.mode).toBe('pipe');
    if (manifest.mode !== 'pipe') return;
    expect(manifest.stdout).toEqual({
      status: 'complete',
      source_completion: 'complete',
      observed_bytes: expectedStdout.byteLength,
      persisted_bytes: expectedStdout.byteLength,
      last_persisted_offset: expectedStdout.byteLength,
      sha256: sha256(expectedStdout),
    });
    expect(manifest.stderr).toEqual({
      status: 'complete',
      source_completion: 'complete',
      observed_bytes: stderr.byteLength,
      persisted_bytes: stderr.byteLength,
      last_persisted_offset: stderr.byteLength,
      sha256: sha256(stderr),
    });
  });

  it('重复 identity 的第二位 writer 失败，但不能删除第一位 writer 的活动目录', async () => {
    const storageRoot = await createStorageRoot();
    const port = createFileCommandOutputArtifactPort({ storageRoot, now: () => 10 });
    const first = await port.open({ owner: createOwner(), mode: 'pipe' });
    expect(first.status).toBe('opened');
    if (first.status !== 'opened') return;

    const duplicate = await port.open({ owner: createOwner(), mode: 'pipe' });
    expect(duplicate).toEqual({
      status: 'unavailable',
      failure: {
        code: 'path_unavailable',
        stage: 'open',
        occurred_at_ms: 10,
        last_persisted_offset: 0,
      },
    });
    const paths = artifactPaths(storageRoot, 'pipe');
    await expect(fsp.stat(paths.stdout)).resolves.toBeDefined();

    expect(first.writer.append({
      mode: 'pipe',
      channel: 'stdout',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: new TextEncoder().encode('still-owned'),
    })).toEqual({ status: 'accepted' });
    await first.writer.finalize({
      sealedAtMs: 20,
      retentionUntilMs: 30,
      source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
    });
    await expect(fsp.readFile(paths.stdout, 'utf8')).resolves.toBe('still-owned');
  });

  it('乱序和模式串线在文件 I/O 前拒绝，且不会推进合法 sequence', async () => {
    const storageRoot = await createStorageRoot();
    const port = createFileCommandOutputArtifactPort({ storageRoot });
    const opened = await port.open({ owner: createOwner(), mode: 'pty' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    expect(() => opened.writer.append({
      mode: 'pty',
      channel: 'terminal',
      sequence: CommandOutputSequenceSchema.parse(1),
      bytes: new TextEncoder().encode('out-of-order'),
    })).toThrow('sequence mismatch');
    expect(() => opened.writer.append({
      mode: 'pipe',
      channel: 'stdout',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: new TextEncoder().encode('wrong-mode'),
    })).toThrow('mode mismatch');

    expect(opened.writer.append({
      mode: 'pty',
      channel: 'terminal',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: new TextEncoder().encode('valid'),
    })).toEqual({ status: 'accepted' });
    await opened.writer.finalize({
      sealedAtMs: 20,
      retentionUntilMs: 30,
      source: { mode: 'pty', terminal: 'complete' },
    });
    await expect(fsp.readFile(artifactPaths(storageRoot, 'pty').terminal, 'utf8'))
      .resolves.toBe('valid');
  });

  it('首次 append 存储失败后停止 stream I/O，但继续统计所有已观察 byte', async () => {
    const storageRoot = await createStorageRoot();
    const real = createRealFileOperations();
    let binaryWriteCalls = 0;
    const operations: CommandOutputArtifactFileOperations = {
      ...real,
      async openExclusive(filePath) {
        const file = await real.openExclusive(filePath);
        if (!filePath.endsWith('.bin')) return file;
        return {
          ...file,
          async write(bytes, offset, length, position) {
            binaryWriteCalls += 1;
            if (binaryWriteCalls === 2) {
              throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
            }
            return file.write(bytes, offset, length, position);
          },
        };
      },
    };
    const port = createFileCommandOutputArtifactPort({
      storageRoot,
      operations,
      now: () => 100,
    });
    const opened = await port.open({ owner: createOwner(), mode: 'pipe' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    expect(opened.writer.append({
      mode: 'pipe',
      channel: 'stdout',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: new TextEncoder().encode('ok'),
    })).toEqual({ status: 'accepted' });
    expect(opened.writer.append({
      mode: 'pipe',
      channel: 'stdout',
      sequence: CommandOutputSequenceSchema.parse(1),
      bytes: new TextEncoder().encode('lost'),
    })).toEqual({ status: 'accepted' });
    expect(opened.writer.append({
      mode: 'pipe',
      channel: 'stderr',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: new TextEncoder().encode('also-observed'),
    })).toEqual({ status: 'accepted' });

    const finalized = await opened.writer.finalize({
      sealedAtMs: 200,
      retentionUntilMs: 300,
      source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
    });
    expect(finalized.status).toBe('manifest_persisted');
    expect(binaryWriteCalls).toBe(2);
    if (finalized.manifest.mode !== 'pipe') return;
    expect(finalized.manifest.stdout).toEqual({
      status: 'incomplete',
      source_completion: 'complete',
      observed_bytes: 6,
      persisted_bytes: 2,
      last_persisted_offset: 2,
      first_error: {
        code: 'storage_full',
        stage: 'append',
        occurred_at_ms: 100,
        last_persisted_offset: 2,
      },
    });
    expect(finalized.manifest.stderr).toEqual({
      status: 'incomplete',
      source_completion: 'complete',
      observed_bytes: 13,
      persisted_bytes: 0,
      last_persisted_offset: 0,
      first_error: {
        code: 'storage_full',
        stage: 'append',
        occurred_at_ms: 100,
        last_persisted_offset: 0,
      },
    });
  });

  it('慢存储下按 execution 共享 byte 预算，超限立即熔断且不篡改已接纳 byte', async () => {
    const storageRoot = await createStorageRoot();
    const real = createRealFileOperations();
    const writeEntered = deferred();
    const releaseWrite = deferred();
    let binaryWriteCalls = 0;
    const operations: CommandOutputArtifactFileOperations = {
      ...real,
      async openExclusive(filePath) {
        const file = await real.openExclusive(filePath);
        if (!filePath.endsWith('.bin')) return file;
        return {
          ...file,
          async write(bytes, offset, length, position) {
            binaryWriteCalls += 1;
            if (binaryWriteCalls === 1) {
              writeEntered.resolve();
              await releaseWrite.promise;
            }
            return file.write(bytes, offset, length, position);
          },
        };
      },
    };
    const writerLimits = { maxPendingEvents: 10, maxPendingBytes: 4 };
    const port = createFileCommandOutputArtifactPort({
      storageRoot,
      operations,
      now: () => 500,
      writerLimits,
    });
    writerLimits.maxPendingBytes = 100;
    const opened = await port.open({ owner: createOwner(), mode: 'pipe' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    const largeBacking = new Uint8Array(1024 * 1024);
    largeBacking.set([1, 2], 128);
    const stdout = largeBacking.subarray(128, 130);
    expect(opened.writer.append({
      mode: 'pipe',
      channel: 'stdout',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: stdout,
    })).toEqual({ status: 'accepted' });
    largeBacking.fill(9);
    await writeEntered.promise;

    expect(opened.writer.append({
      mode: 'pipe',
      channel: 'stderr',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: Uint8Array.from([3, 4]),
    })).toEqual({ status: 'accepted' });
    expect(opened.writer.append({
      mode: 'pipe',
      channel: 'stdout',
      sequence: CommandOutputSequenceSchema.parse(1),
      bytes: Uint8Array.from([5]),
    })).toEqual({ status: 'disabled', firstFailureCode: 'sink_overloaded' });
    expect(binaryWriteCalls).toBe(1);

    const finalizePromise = opened.writer.finalize({
      sealedAtMs: 600,
      retentionUntilMs: 700,
      source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
    });
    await expect(Promise.race([
      finalizePromise.then(() => 'finalized'),
      Promise.resolve('pending'),
    ])).resolves.toBe('pending');

    releaseWrite.resolve();
    const finalized = await finalizePromise;
    expect(finalized.status).toBe('manifest_persisted');
    expect(binaryWriteCalls).toBe(2);
    if (finalized.manifest.mode !== 'pipe') return;
    expect(finalized.manifest.stdout).toEqual({
      status: 'incomplete',
      source_completion: 'complete',
      observed_bytes: 3,
      persisted_bytes: 2,
      last_persisted_offset: 2,
      first_error: {
        code: 'sink_overloaded',
        stage: 'append',
        occurred_at_ms: 500,
        last_persisted_offset: 2,
      },
    });
    expect(finalized.manifest.stderr.status).toBe('complete');
    await expect(fsp.readFile(artifactPaths(storageRoot, 'pipe').stdout))
      .resolves.toEqual(Buffer.from([1, 2]));
  });

  it('大量极小 chunk 不能绕过 pending event 预算', async () => {
    const storageRoot = await createStorageRoot();
    const real = createRealFileOperations();
    const writeEntered = deferred();
    const releaseWrite = deferred();
    let binaryWriteCalls = 0;
    const operations: CommandOutputArtifactFileOperations = {
      ...real,
      async openExclusive(filePath) {
        const file = await real.openExclusive(filePath);
        if (!filePath.endsWith('.bin')) return file;
        return {
          ...file,
          async write(bytes, offset, length, position) {
            binaryWriteCalls += 1;
            if (binaryWriteCalls === 1) {
              writeEntered.resolve();
              await releaseWrite.promise;
            }
            return file.write(bytes, offset, length, position);
          },
        };
      },
    };
    const port = createFileCommandOutputArtifactPort({
      storageRoot,
      operations,
      now: () => 800,
      writerLimits: { maxPendingEvents: 2, maxPendingBytes: 100 },
    });
    const opened = await port.open({ owner: createOwner(), mode: 'pty' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    expect(opened.writer.append({
      mode: 'pty',
      channel: 'terminal',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: Uint8Array.from([1]),
    })).toEqual({ status: 'accepted' });
    await writeEntered.promise;
    expect(opened.writer.append({
      mode: 'pty',
      channel: 'terminal',
      sequence: CommandOutputSequenceSchema.parse(1),
      bytes: Uint8Array.from([2]),
    })).toEqual({ status: 'accepted' });
    expect(opened.writer.append({
      mode: 'pty',
      channel: 'terminal',
      sequence: CommandOutputSequenceSchema.parse(2),
      bytes: Uint8Array.from([3]),
    })).toEqual({ status: 'disabled', firstFailureCode: 'sink_overloaded' });

    releaseWrite.resolve();
    const finalized = await opened.writer.finalize({
      sealedAtMs: 900,
      retentionUntilMs: 1_000,
      source: { mode: 'pty', terminal: 'complete' },
    });
    expect(finalized.manifest.mode).toBe('pty');
    if (finalized.manifest.mode !== 'pty') return;
    expect(finalized.manifest.terminal).toMatchObject({
      status: 'incomplete',
      observed_bytes: 3,
      persisted_bytes: 2,
      first_error: { code: 'sink_overloaded', last_persisted_offset: 2 },
    });
  });

  it('单个 chunk 超过注入的 byte 预算时不复制、不启动文件 I/O', async () => {
    const storageRoot = await createStorageRoot();
    const real = createRealFileOperations();
    let binaryWriteCalls = 0;
    const operations: CommandOutputArtifactFileOperations = {
      ...real,
      async openExclusive(filePath) {
        const file = await real.openExclusive(filePath);
        if (!filePath.endsWith('.bin')) return file;
        return {
          ...file,
          async write(bytes, offset, length, position) {
            binaryWriteCalls += 1;
            return file.write(bytes, offset, length, position);
          },
        };
      },
    };
    const port = createFileCommandOutputArtifactPort({
      storageRoot,
      operations,
      now: () => 1_100,
      writerLimits: { maxPendingEvents: 10, maxPendingBytes: 4 },
    });
    const opened = await port.open({ owner: createOwner(), mode: 'pty' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    expect(opened.writer.append({
      mode: 'pty',
      channel: 'terminal',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: Uint8Array.from([1, 2, 3, 4, 5]),
    })).toEqual({ status: 'disabled', firstFailureCode: 'sink_overloaded' });
    const finalized = await opened.writer.finalize({
      sealedAtMs: 1_200,
      retentionUntilMs: 1_300,
      source: { mode: 'pty', terminal: 'complete' },
    });
    expect(binaryWriteCalls).toBe(0);
    expect(finalized.manifest.mode).toBe('pty');
    if (finalized.manifest.mode !== 'pty') return;
    expect(finalized.manifest.terminal).toMatchObject({
      observed_bytes: 5,
      persisted_bytes: 0,
      first_error: { code: 'sink_overloaded', last_persisted_offset: 0 },
    });
  });

  it('manifest 原子发布失败不改写已经完成的 stream 事实', async () => {
    const storageRoot = await createStorageRoot();
    const real = createRealFileOperations();
    const operations: CommandOutputArtifactFileOperations = {
      ...real,
      async rename(sourcePath, destinationPath) {
        if (destinationPath.endsWith('manifest.json')) {
          throw Object.assign(new Error('read only'), { code: 'EACCES' });
        }
        await real.rename(sourcePath, destinationPath);
      },
    };
    const port = createFileCommandOutputArtifactPort({
      storageRoot,
      operations,
      now: () => 400,
    });
    const opened = await port.open({ owner: createOwner(), mode: 'pty' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;
    expect(opened.writer.append({
      mode: 'pty',
      channel: 'terminal',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: new TextEncoder().encode('terminal'),
    })).toEqual({ status: 'accepted' });

    const finalized = await opened.writer.finalize({
      sealedAtMs: 500,
      retentionUntilMs: 600,
      source: { mode: 'pty', terminal: 'complete' },
    });
    expect(finalized).toMatchObject({
      status: 'manifest_unavailable',
      failure: {
        code: 'permission_denied',
        stage: 'finalize',
        occurred_at_ms: 400,
      },
      manifest: {
        mode: 'pty',
        terminal: { status: 'complete' },
      },
    });
    await expect(fsp.stat(artifactPaths(storageRoot, 'pty').manifest)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('runner 未读到 stdout EOF 时，即使已收到 byte 全部落盘也标记来源不完整', async () => {
    const storageRoot = await createStorageRoot();
    const port = createFileCommandOutputArtifactPort({ storageRoot });
    const opened = await port.open({ owner: createOwner(), mode: 'pipe' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;
    const partial = new TextEncoder().encode('received-before-runner-crash');
    expect(opened.writer.append({
      mode: 'pipe',
      channel: 'stdout',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: partial,
    })).toEqual({ status: 'accepted' });

    const finalized = await opened.writer.finalize({
      sealedAtMs: 700,
      retentionUntilMs: 800,
      source: { mode: 'pipe', stdout: 'interrupted', stderr: 'complete' },
    });
    expect(finalized.status).toBe('manifest_persisted');
    if (finalized.manifest.mode !== 'pipe') return;
    expect(finalized.manifest.stdout).toEqual({
      status: 'incomplete',
      source_completion: 'interrupted',
      observed_bytes: partial.byteLength,
      persisted_bytes: partial.byteLength,
      last_persisted_offset: partial.byteLength,
      sha256: sha256(partial),
    });
    expect(finalized.manifest.stderr).toMatchObject({
      status: 'complete',
      source_completion: 'complete',
    });
  });

  it('finalize 来源模式必须匹配 writer，错误请求不能封存 writer', async () => {
    const storageRoot = await createStorageRoot();
    const port = createFileCommandOutputArtifactPort({ storageRoot });
    const opened = await port.open({ owner: createOwner(), mode: 'pipe' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    await expect(opened.writer.finalize({
      sealedAtMs: 900,
      retentionUntilMs: 1_000,
      source: { mode: 'pty', terminal: 'complete' },
    })).rejects.toThrow('finalize mode mismatch');
    await expect(opened.writer.finalize({
      sealedAtMs: 900,
      retentionUntilMs: 1_000,
      source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
    })).resolves.toMatchObject({ status: 'manifest_persisted' });
  });

  it('稳定映射常见跨平台存储错误，不把错误文案暴露到 domain', () => {
    expect(classifyCommandOutputArtifactStorageError(
      Object.assign(new Error('full'), { code: 'ENOSPC' }),
    )).toBe('storage_full');
    expect(classifyCommandOutputArtifactStorageError(
      Object.assign(new Error('quota'), { code: 'EDQUOT' }),
    )).toBe('quota_exceeded');
    expect(classifyCommandOutputArtifactStorageError(
      Object.assign(new Error('denied'), { code: 'EPERM' }),
    )).toBe('permission_denied');
    expect(classifyCommandOutputArtifactStorageError(
      Object.assign(new Error('missing'), { code: 'ENOENT' }),
    )).toBe('path_unavailable');
    expect(classifyCommandOutputArtifactStorageError(new Error('other'))).toBe('io_failure');
  });
});
