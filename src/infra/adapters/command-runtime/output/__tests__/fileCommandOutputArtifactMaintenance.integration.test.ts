import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CommandOutputArtifactManifestSchema,
  CommandOutputArtifactOwnerSchema,
  CommandOutputSequenceSchema,
  type CommandOutputArtifactOwner,
} from '../../../../../domains/commands/definitions/commandOutputArtifact';
import { createFileCommandOutputArtifactMaintenancePort } from '../createFileCommandOutputArtifactMaintenancePort';
import { createFileCommandOutputArtifactPort } from '../createFileCommandOutputArtifactPort';
import { deriveCommandOutputArtifactRelativePaths } from '../functions/deriveCommandOutputArtifactRelativePaths';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

function createOwner(input: {
  readonly conversationId: string;
  readonly instanceId: string;
}): CommandOutputArtifactOwner {
  return CommandOutputArtifactOwnerSchema.parse({
    identity: {
      conversation_id: input.conversationId,
      agent_run_id: input.instanceId,
      origin_tool_call_id: `tool_${randomUUID()}`,
      command_execution_id: `command_execution_${randomUUID()}`,
      owner_generation_id: `command_owner_${randomUUID()}`,
      created_at_ms: 100,
    },
    instance_id: input.instanceId,
  });
}

function executionDirectory(input: {
  readonly storageRoot: string;
  readonly owner: CommandOutputArtifactOwner;
  readonly mode: 'pipe' | 'pty';
}): string {
  return path.join(
    input.storageRoot,
    ...deriveCommandOutputArtifactRelativePaths(input.owner, input.mode).directorySegments
  );
}

async function createSealedArtifact(input: {
  readonly storageRoot: string;
  readonly owner: CommandOutputArtifactOwner;
  readonly mode: 'pipe' | 'pty';
  readonly retentionUntilMs: number;
}): Promise<string> {
  const port = createFileCommandOutputArtifactPort({ storageRoot: input.storageRoot });
  const opened = await port.open({ owner: input.owner, mode: input.mode });
  if (opened.status !== 'opened') throw new Error('test artifact did not open');
  if (input.mode === 'pipe') {
    opened.writer.append({
      mode: 'pipe',
      channel: 'stdout',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: new TextEncoder().encode('stdout'),
    });
    const finalized = await opened.writer.finalize({
      sealedAtMs: 100,
      retentionUntilMs: input.retentionUntilMs,
      source: { mode: 'pipe', stdout: 'complete', stderr: 'complete' },
    });
    if (finalized.status !== 'manifest_persisted') throw new Error('test artifact did not seal');
  } else {
    opened.writer.append({
      mode: 'pty',
      channel: 'terminal',
      sequence: CommandOutputSequenceSchema.parse(0),
      bytes: new TextEncoder().encode('terminal'),
    });
    const finalized = await opened.writer.finalize({
      sealedAtMs: 100,
      retentionUntilMs: input.retentionUntilMs,
      source: { mode: 'pty', terminal: 'complete' },
    });
    if (finalized.status !== 'manifest_persisted') throw new Error('test artifact did not seal');
  }
  return executionDirectory(input);
}

describe('原始命令输出启动维护', () => {
  it('未完成运行保护会话的过期原始输出，终态释放后恢复正常清理', async () => {
    const storageRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'linnya-command-artifact-recovery-')
    );
    roots.push(storageRoot);
    const owner = createOwner({
      conversationId: 'paused-conversation',
      instanceId: 'completed-child',
    });
    const directory = await createSealedArtifact({
      storageRoot,
      owner,
      mode: 'pipe',
      retentionUntilMs: 150,
    });
    const maintenance = createFileCommandOutputArtifactMaintenancePort({
      storageRoot,
      logger: { warn: vi.fn() },
    });
    expect(
      await maintenance.cleanupExpired({
        nowMs: 200,
        protectedConversationIds: new Set(['paused-conversation']),
      })
    ).toMatchObject({ retained: 1, deleted: 0 });
    await expect(fsp.readFile(path.join(directory, 'stdout.bin'), 'utf8')).resolves.toBe('stdout');
    expect(await maintenance.cleanupExpired({ nowMs: 200 })).toMatchObject({ deleted: 1 });
    await expect(fsp.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('按每份已封口 manifest 的冻结期限精准清理 pipe，并保留尚未到期的 PTY', async () => {
    const storageRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'linnya-command-artifact-maintenance-')
    );
    roots.push(storageRoot);
    const expiredOwner = createOwner({ conversationId: 'conversation-a', instanceId: 'run-a' });
    const retainedOwner = createOwner({ conversationId: 'conversation-b', instanceId: 'run-b' });
    const expiredDirectory = await createSealedArtifact({
      storageRoot,
      owner: expiredOwner,
      mode: 'pipe',
      retentionUntilMs: 200,
    });
    const retainedDirectory = await createSealedArtifact({
      storageRoot,
      owner: retainedOwner,
      mode: 'pty',
      retentionUntilMs: 201,
    });
    const logger = { warn: vi.fn() };

    const stats = await createFileCommandOutputArtifactMaintenancePort({
      storageRoot,
      logger,
    }).cleanupExpired({ nowMs: 200 });

    expect(stats).toEqual({ scanned: 2, retained: 1, deleted: 1, failed: 0 });
    await expect(fsp.stat(expiredDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.stat(path.join(retainedDirectory, 'manifest.json'))).resolves.toBeTruthy();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('保留未封口、损坏和身份错位目录，且不触碰不属于固定路径形状的内容', async () => {
    const storageRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'linnya-command-artifact-preserve-')
    );
    roots.push(storageRoot);
    const unsealedOwner = createOwner({ conversationId: 'conversation-a', instanceId: 'run-a' });
    const malformedOwner = createOwner({ conversationId: 'conversation-b', instanceId: 'run-b' });
    const misplacedOwner = createOwner({ conversationId: 'conversation-c', instanceId: 'run-c' });
    const otherOwner = createOwner({ conversationId: 'conversation-d', instanceId: 'run-d' });
    const unsealedDirectory = executionDirectory({
      storageRoot,
      owner: unsealedOwner,
      mode: 'pipe',
    });
    const malformedDirectory = executionDirectory({
      storageRoot,
      owner: malformedOwner,
      mode: 'pipe',
    });
    const misplacedDirectory = executionDirectory({
      storageRoot,
      owner: misplacedOwner,
      mode: 'pipe',
    });
    await fsp.mkdir(unsealedDirectory, { recursive: true });
    await fsp.writeFile(path.join(unsealedDirectory, 'stdout.bin'), 'partial', 'utf8');
    await fsp.mkdir(malformedDirectory, { recursive: true });
    await fsp.writeFile(path.join(malformedDirectory, 'manifest.json'), '{broken', 'utf8');
    await fsp.mkdir(misplacedDirectory, { recursive: true });
    const misplacedManifest = CommandOutputArtifactManifestSchema.parse({
      version: 1,
      owner: otherOwner,
      sealed_at_ms: 100,
      retention_until_ms: 150,
      mode: 'pipe',
      stdout: {
        status: 'complete',
        source_completion: 'complete',
        observed_bytes: 0,
        persisted_bytes: 0,
        last_persisted_offset: 0,
        sha256: '0'.repeat(64),
      },
      stderr: {
        status: 'complete',
        source_completion: 'complete',
        observed_bytes: 0,
        persisted_bytes: 0,
        last_persisted_offset: 0,
        sha256: '0'.repeat(64),
      },
    });
    await fsp.writeFile(
      path.join(misplacedDirectory, 'manifest.json'),
      JSON.stringify(misplacedManifest),
      'utf8'
    );
    const unrelatedDirectory = path.join(storageRoot, 'conversation-not-owned');
    await fsp.mkdir(unrelatedDirectory, { recursive: true });
    await fsp.writeFile(path.join(unrelatedDirectory, 'keep.txt'), 'keep', 'utf8');
    const linkedOwner = createOwner({ conversationId: 'conversation-e', instanceId: 'run-e' });
    const linkedDirectory = executionDirectory({ storageRoot, owner: linkedOwner, mode: 'pipe' });
    const linkedTarget = path.join(storageRoot, 'outside-command-output');
    await fsp.mkdir(path.dirname(linkedDirectory), { recursive: true });
    await fsp.mkdir(linkedTarget, { recursive: true });
    await fsp.writeFile(path.join(linkedTarget, 'keep.txt'), 'linked target', 'utf8');
    await fsp.symlink(
      linkedTarget,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    const logger = { warn: vi.fn() };

    const stats = await createFileCommandOutputArtifactMaintenancePort({
      storageRoot,
      logger,
    }).cleanupExpired({ nowMs: 200 });

    expect(stats).toEqual({ scanned: 3, retained: 0, deleted: 0, failed: 3 });
    await expect(fsp.stat(unsealedDirectory)).resolves.toBeTruthy();
    await expect(fsp.stat(malformedDirectory)).resolves.toBeTruthy();
    await expect(fsp.stat(misplacedDirectory)).resolves.toBeTruthy();
    await expect(fsp.readFile(path.join(unrelatedDirectory, 'keep.txt'), 'utf8')).resolves.toBe(
      'keep'
    );
    await expect(fsp.readFile(path.join(linkedTarget, 'keep.txt'), 'utf8')).resolves.toBe(
      'linked target'
    );
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it('单个损坏 artifact 不阻止同一扫描中的合法过期 artifact 清理', async () => {
    const storageRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'linnya-command-artifact-isolation-')
    );
    roots.push(storageRoot);
    const brokenOwner = createOwner({ conversationId: 'conversation-a', instanceId: 'run-a' });
    const expiredOwner = createOwner({ conversationId: 'conversation-b', instanceId: 'run-b' });
    const brokenDirectory = executionDirectory({ storageRoot, owner: brokenOwner, mode: 'pty' });
    await fsp.mkdir(brokenDirectory, { recursive: true });
    await fsp.writeFile(path.join(brokenDirectory, 'manifest.json'), 'null', 'utf8');
    const expiredDirectory = await createSealedArtifact({
      storageRoot,
      owner: expiredOwner,
      mode: 'pty',
      retentionUntilMs: 150,
    });
    const logger = { warn: vi.fn() };

    const stats = await createFileCommandOutputArtifactMaintenancePort({
      storageRoot,
      logger,
    }).cleanupExpired({ nowMs: 200 });

    expect(stats).toEqual({ scanned: 2, retained: 0, deleted: 1, failed: 1 });
    await expect(fsp.stat(brokenDirectory)).resolves.toBeTruthy();
    await expect(fsp.stat(expiredDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('一个损坏的 conversation 路径不会阻止其他 conversation 的合法清理', async () => {
    const storageRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'linnya-command-artifact-scan-isolation-')
    );
    roots.push(storageRoot);
    const brokenOwner = createOwner({ conversationId: 'conversation-a', instanceId: 'run-a' });
    const brokenRelativePaths = deriveCommandOutputArtifactRelativePaths(brokenOwner, 'pipe');
    const brokenConversationRoot = path.join(storageRoot, brokenRelativePaths.directorySegments[0]);
    await fsp.mkdir(brokenConversationRoot, { recursive: true });
    await fsp.writeFile(path.join(brokenConversationRoot, 'instances'), 'not a directory', 'utf8');
    const expiredOwner = createOwner({ conversationId: 'conversation-b', instanceId: 'run-b' });
    const expiredDirectory = await createSealedArtifact({
      storageRoot,
      owner: expiredOwner,
      mode: 'pipe',
      retentionUntilMs: 150,
    });
    const logger = { warn: vi.fn() };

    const stats = await createFileCommandOutputArtifactMaintenancePort({
      storageRoot,
      logger,
    }).cleanupExpired({ nowMs: 200 });

    expect(stats).toEqual({ scanned: 1, retained: 0, deleted: 1, failed: 1 });
    await expect(fsp.stat(expiredDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
