import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CommandOutputArtifactOwnerSchema,
  CommandOutputSequenceSchema,
} from '../../../../../domains/commands/definitions/commandOutputArtifact';
import type {
  CommandOutputArtifactFileOperations,
  CommandOutputArtifactWritableFile,
} from '../createFileCommandOutputArtifactPort';
import { createFileCommandOutputArtifactPort } from '../createFileCommandOutputArtifactPort';
import { deriveCommandOutputArtifactRelativePaths } from '../functions/deriveCommandOutputArtifactRelativePaths';

const temporaryRoots: string[] = [];

function createOwner() {
  return CommandOutputArtifactOwnerSchema.parse({
    identity: {
      conversation_id: 'conversation/artifact-discard-test',
      agent_run_id: 'run-a',
      origin_tool_call_id: 'shell-call-a',
      command_execution_id: 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d3a',
      owner_generation_id: 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d3b',
      created_at_ms: 1_785_499_200_000,
    },
    instance_id: 'default',
  });
}

async function createStorageRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-command-output-discard-'));
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

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

describe('file command output artifact pre-start discard', () => {
  it('先关闭 pipe 双流再删除空目录且不伪造 manifest', async () => {
    const storageRoot = await createStorageRoot();
    const port = createFileCommandOutputArtifactPort({ storageRoot });
    const opened = await port.open({ owner: createOwner(), mode: 'pipe' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;
    const paths = artifactPaths(storageRoot, 'pipe');
    await expect(fsp.stat(paths.stdout)).resolves.toBeDefined();
    await expect(fsp.stat(paths.stderr)).resolves.toBeDefined();

    await expect(opened.writer.discardBeforeSourceStart())
      .resolves.toEqual({ status: 'discarded' });
    await expect(fsp.stat(paths.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.stat(paths.manifest)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => opened.writer.append({
      mode: 'pipe',
      channel: 'stdout',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: new TextEncoder().encode('late-output'),
    })).toThrow('already started discard');
    await expect(opened.writer.finalize({
      sealedAtMs: 20,
      retentionUntilMs: 30,
      source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
    })).rejects.toThrow('already started discard');
  });

  it('接收过合法 output 后禁止丢弃，并仍可 finalize 保存真实 byte', async () => {
    const storageRoot = await createStorageRoot();
    const port = createFileCommandOutputArtifactPort({ storageRoot });
    const opened = await port.open({ owner: createOwner(), mode: 'pty' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;
    const output = new TextEncoder().encode('must-not-be-discarded');
    expect(opened.writer.append({
      mode: 'pty',
      channel: 'terminal',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: output,
    })).toEqual({ status: 'accepted' });

    await expect(opened.writer.discardBeforeSourceStart())
      .rejects.toThrow('already observed output');
    await expect(opened.writer.finalize({
      sealedAtMs: 20,
      retentionUntilMs: 30,
      source: { mode: 'pty', terminal: 'complete' },
    })).resolves.toMatchObject({ status: 'manifest_persisted' });
    await expect(fsp.readFile(artifactPaths(storageRoot, 'pty').terminal))
      .resolves.toEqual(Buffer.from(output));
  });

  it('目录删除失败返回稳定失败事实，且 writer 不会重新开放', async () => {
    const storageRoot = await createStorageRoot();
    const real = createRealFileOperations();
    const operations: CommandOutputArtifactFileOperations = {
      ...real,
      async removeDirectory() {
        throw Object.assign(new Error('read only'), { code: 'EACCES' });
      },
    };
    const port = createFileCommandOutputArtifactPort({
      storageRoot,
      operations,
      now: () => 40,
    });
    const opened = await port.open({ owner: createOwner(), mode: 'pipe' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    await expect(opened.writer.discardBeforeSourceStart()).resolves.toEqual({
      status: 'discard_failed',
      failure: {
        code: 'permission_denied',
        stage: 'discard',
        occurred_at_ms: 40,
        last_persisted_offset: 0,
      },
    });
    await expect(fsp.stat(artifactPaths(storageRoot, 'pipe').directory)).resolves.toBeDefined();
    await expect(opened.writer.discardBeforeSourceStart())
      .rejects.toThrow('already started discard');
  });

  it('任一文件关闭失败时仍关闭其余文件并保留目录', async () => {
    const storageRoot = await createStorageRoot();
    const real = createRealFileOperations();
    let binaryFileIndex = 0;
    let successfulCloseCount = 0;
    let removeDirectoryCalls = 0;
    const operations: CommandOutputArtifactFileOperations = {
      ...real,
      async openExclusive(filePath) {
        const file = await real.openExclusive(filePath);
        if (!filePath.endsWith('.bin')) return file;
        binaryFileIndex += 1;
        const currentIndex = binaryFileIndex;
        return {
          ...file,
          async close() {
            if (currentIndex === 1) {
              await file.close();
              throw Object.assign(new Error('close failed'), { code: 'EIO' });
            }
            await file.close();
            successfulCloseCount += 1;
          },
        };
      },
      async removeDirectory(directoryPath) {
        removeDirectoryCalls += 1;
        await real.removeDirectory(directoryPath);
      },
    };
    const port = createFileCommandOutputArtifactPort({
      storageRoot,
      operations,
      now: () => 50,
    });
    const opened = await port.open({ owner: createOwner(), mode: 'pipe' });
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened') return;

    await expect(opened.writer.discardBeforeSourceStart()).resolves.toEqual({
      status: 'discard_failed',
      failure: {
        code: 'io_failure',
        stage: 'discard',
        occurred_at_ms: 50,
        last_persisted_offset: 0,
      },
    });
    expect(successfulCloseCount).toBe(1);
    expect(removeDirectoryCalls).toBe(0);
    await expect(fsp.stat(artifactPaths(storageRoot, 'pipe').directory)).resolves.toBeDefined();
  });
});
