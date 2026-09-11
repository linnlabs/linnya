import { afterEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { cleanupToolOutputStoreByTime } from '../orchestration/cleanupToolOutputStore';
import { createToolOutputTextBlobWriter } from '../orchestration/createToolOutputTextBlobWriter';

async function writeJsonFile(filePath: string, ageDays: number): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify({ ok: true }), 'utf8');
  const mtime = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1_000);
  await fsp.utimes(filePath, mtime, mtime);
}

describe('ToolOutputStore 启动清理', () => {
  const tempDirectories: string[] = [];

  afterEach(async () => {
    for (const directory of tempDirectories.splice(0)) {
      await fsp.rm(directory, { recursive: true, force: true });
    }
  });

  it('只清理 conversation artifact 权威路径中的崩溃残留和过期内容', async () => {
    const workspaceRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya-tool-output-cleanup-'));
    tempDirectories.push(workspaceRoot);
    const blobsRoot = path.join(
      workspaceRoot,
      'Artifacts',
      'v1',
      'conversations',
      'conv_1',
      'instances',
      'inst_1',
      'tool_output',
      'blobs'
    );
    const oldLegacyArtifact = path.join(blobsRoot, 'aaaaaaaaaaaaaaaa.json');
    const recentLegacyArtifact = path.join(blobsRoot, 'bbbbbbbbbbbbbbbb.json');
    const writer = await createToolOutputTextBlobWriter({
      blobsDirectory: blobsRoot,
      source: {
        kind: 'tool_output_text',
        conversation_id: 'conv_1',
        instance_id: 'inst_1',
        tool_name: 'shell',
      },
    });
    await writer.append('old');
    const published = await writer.finalize();
    const oldCurrentArtifact = path.dirname(published.filePath);
    const recentCurrentArtifact = path.join(blobsRoot, 'dddddddddddddddd');
    const orphanArtifact = path.join(blobsRoot, 'eeeeeeeeeeeeeeee');
    const pendingArtifact = path.join(blobsRoot, '.pending-123-test');
    const unrelatedLegacyArtifact = path.join(
      workspaceRoot,
      'ToolOutputStore',
      'v1',
      'blobs',
      'legacy-old.json'
    );

    await writeJsonFile(oldLegacyArtifact, 8);
    await writeJsonFile(recentLegacyArtifact, 1);
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000);
    await fsp.utimes(published.filePath, oldTime, oldTime);
    await writeJsonFile(path.join(recentCurrentArtifact, 'manifest.json'), 1);
    await fsp.writeFile(
      path.join(recentCurrentArtifact, 'body.utf16le'),
      Buffer.from('recent', 'utf16le')
    );
    await fsp.mkdir(orphanArtifact, { recursive: true });
    await fsp.writeFile(
      path.join(orphanArtifact, 'body.utf16le'),
      Buffer.from('orphan', 'utf16le')
    );
    await fsp.mkdir(pendingArtifact, { recursive: true });
    await fsp.writeFile(
      path.join(pendingArtifact, 'body.utf16le'),
      Buffer.from('pending', 'utf16le')
    );
    await writeJsonFile(unrelatedLegacyArtifact, 8);

    const logger = { warn: vi.fn() };
    const stats = await cleanupToolOutputStoreByTime({
      logger,
      retentionDays: 7,
      workspaceRoot,
    });

    expect(stats).toEqual({ scanned: 6, deleted: 4, failed: 0 });
    await expect(fsp.stat(oldLegacyArtifact)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.stat(oldCurrentArtifact)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.stat(orphanArtifact)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.stat(pendingArtifact)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.stat(recentLegacyArtifact)).resolves.toBeTruthy();
    await expect(fsp.stat(recentCurrentArtifact)).resolves.toBeTruthy();
    await expect(fsp.stat(unrelatedLegacyArtifact)).resolves.toBeTruthy();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('暂停对话的已发布输出超过 TTL 仍可读，解除保护后回收', async () => {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'linnya-tool-output-retention-')
    );
    tempDirectories.push(workspaceRoot);
    const blobsDirectory = path.join(
      workspaceRoot,
      'Artifacts/v1/conversations/conv/instances/default/tool_output/blobs'
    );
    const writer = await createToolOutputTextBlobWriter({
      blobsDirectory,
      source: {
        kind: 'tool_output_text',
        conversation_id: 'paused-conversation',
        instance_id: 'default',
        tool_name: 'shell',
      },
    });
    await writer.append('Original output');
    const published = await writer.finalize();
    const now = Date.now() + 40 * 24 * 60 * 60 * 1_000;
    const input = { workspaceRoot, logger: { warn: vi.fn() }, retentionDays: 7, now };
    expect(
      await cleanupToolOutputStoreByTime({
        ...input,
        protectedConversationIds: new Set(['paused-conversation']),
      })
    ).toMatchObject({ deleted: 0, failed: 0 });
    expect(
      await fsp.readFile(path.join(path.dirname(published.filePath), 'body.utf16le'), 'utf16le')
    ).toBe('Original output');
    expect(await cleanupToolOutputStoreByTime(input)).toMatchObject({ deleted: 1, failed: 0 });
  });

  it('扫描路径损坏时明确记为失败，不能伪装成没有文件', async () => {
    const workspaceRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'linnya-tool-output-scan-failure-')
    );
    tempDirectories.push(workspaceRoot);
    const conversationsPath = path.join(workspaceRoot, 'Artifacts', 'v1', 'conversations');
    await fsp.mkdir(path.dirname(conversationsPath), { recursive: true });
    await fsp.writeFile(conversationsPath, 'not a directory', 'utf8');
    const logger = { warn: vi.fn() };

    await expect(
      cleanupToolOutputStoreByTime({
        logger,
        retentionDays: 7,
        workspaceRoot,
      })
    ).resolves.toEqual({ scanned: 0, deleted: 0, failed: 1 });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ToolOutputStore 扫描失败'));
  });
});
