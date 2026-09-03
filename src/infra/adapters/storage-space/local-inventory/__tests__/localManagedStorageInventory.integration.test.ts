import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createLocalManagedStorageInventoryPort } from '../createLocalManagedStorageInventoryPort';

const tempRoots: string[] = [];

async function createTempRoot(label: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `linnya-storage-${label}-`));
  tempRoots.push(root);
  return root;
}

async function writeSizedFile(filePath: string, byteSize: number): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, Buffer.alloc(byteSize, 1));
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

describe('local managed storage inventory', () => {
  it('一次遍历把两个物理根互斥归入六类，并只统计受管诊断日志', async () => {
    const appDataRoot = await createTempRoot('app-data');
    const workspaceRoot = await createTempRoot('workspace');
    const outsideRoot = await createTempRoot('outside');
    const conversationWorkFilesRoot = path.join(
      appDataRoot,
      'ConversationWorkDirectories',
      'v1',
      'workspaces',
    );
    const managedAttachments = path.join(appDataRoot, 'ConversationAttachments', 'v1');
    const legacyAttachments = path.join(workspaceRoot, 'ManagedAssets', 'v1');
    const diagnosticLogRoot = path.join(workspaceRoot, 'logs');
    const artifactsRoot = path.join(workspaceRoot, 'Artifacts', 'v1');
    const conversationArtifactsRoot = path.join(artifactsRoot, 'conversations');

    await writeSizedFile(path.join(conversationWorkFilesRoot, 'conversation-a', 'work.bin'), 11);
    await writeSizedFile(path.join(managedAttachments, 'content', 'aa', 'image.png'), 13);
    await writeSizedFile(path.join(managedAttachments, 'staging', 'draft.upload'), 17);
    await writeSizedFile(path.join(legacyAttachments, 'content', 'legacy.png'), 19);
    await writeSizedFile(path.join(diagnosticLogRoot, 'backend-2026-08-03.log'), 23);
    await writeSizedFile(path.join(diagnosticLogRoot, 'backend-2026-08-03.1.log'), 29);
    await writeSizedFile(path.join(diagnosticLogRoot, 'qdrant.log'), 31);
    await writeSizedFile(path.join(
      conversationArtifactsRoot,
      'conversation-a',
      'instances',
      'instance-a',
      'tool_output',
      'blobs',
      'blob-a',
      'body.bin',
    ), 37);
    await writeSizedFile(path.join(
      artifactsRoot,
      `conversation_${'a'.repeat(64)}`,
      'instances',
      `instance_${'b'.repeat(64)}`,
      'command-output',
      'execution-a',
      'stdout.bin',
    ), 41);
    await writeSizedFile(path.join(
      conversationArtifactsRoot,
      'conversation-a',
      'instances',
      'instance-a',
      'evidence',
      'bundle.json',
    ), 43);
    await writeSizedFile(path.join(
      conversationArtifactsRoot,
      'conversation-a',
      'instances',
      'instance-a',
      'evidence',
      'command-output',
      'not-a-command-artifact.bin',
    ), 44);
    await writeSizedFile(path.join(
      artifactsRoot,
      'research',
      'tool_output',
      'not-a-tool-output.bin',
    ), 45);
    await writeSizedFile(path.join(workspaceRoot, 'workspace', 'workspace.sqlite'), 47);
    await writeSizedFile(path.join(workspaceRoot, 'workspace', 'workspace.sqlite-wal'), 53);
    await writeSizedFile(path.join(appDataRoot, 'config', 'command_permission.json'), 59);
    await writeSizedFile(path.join(outsideRoot, 'outside.bin'), 61);
    await fsp.symlink(
      outsideRoot,
      path.join(conversationWorkFilesRoot, 'outside-link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const linkSize = (await fsp.lstat(
      path.join(conversationWorkFilesRoot, 'outside-link'),
    )).size;

    const inventory = await createLocalManagedStorageInventoryPort({
      appDataRoot,
      workspaceRoot,
      conversationWorkFilesRoot,
      attachmentRoots: [managedAttachments, legacyAttachments],
      diagnosticLogRoot,
      artifactsRoot,
    }).measure();

    expect(Object.fromEntries(inventory.categories.map(category => [category.kind, category])))
      .toMatchObject({
        conversation_work_files: { byteSize: 11 + linkSize, fileCount: 2 },
        attachments: { byteSize: 49, fileCount: 3 },
        diagnostic_logs: { byteSize: 52, fileCount: 2 },
        temporary_outputs: { byteSize: 78, fileCount: 2 },
        workspace: { byteSize: 263, fileCount: 6 },
        application_data: { byteSize: 59, fileCount: 1 },
      });
    expect(inventory.total).toEqual({
      byteSize: inventory.categories.reduce((sum, category) => sum + category.byteSize, 0),
      fileCount: inventory.categories.reduce((sum, category) => sum + category.fileCount, 0),
    });
    await expect(fsp.readFile(path.join(outsideRoot, 'outside.bin')))
      .resolves.toHaveLength(61);
  });

  it('开发态 AppData 与 Workspace 同根时只遍历一次，缺失分类根不会被读取创建', async () => {
    const sharedRoot = await createTempRoot('shared');
    const missingWorkFilesRoot = path.join(sharedRoot, 'missing-work-files');
    const missingAttachmentsRoot = path.join(sharedRoot, 'missing-attachments');
    await writeSizedFile(path.join(sharedRoot, 'workspace', 'workspace.sqlite'), 7);

    const inventory = await createLocalManagedStorageInventoryPort({
      appDataRoot: sharedRoot,
      workspaceRoot: sharedRoot,
      conversationWorkFilesRoot: missingWorkFilesRoot,
      attachmentRoots: [missingAttachmentsRoot],
      diagnosticLogRoot: path.join(sharedRoot, 'logs'),
      artifactsRoot: path.join(sharedRoot, 'Artifacts', 'v1'),
    }).measure();

    expect(inventory.total).toEqual({ byteSize: 7, fileCount: 1 });
    expect(inventory.categories.find(category => category.kind === 'workspace'))
      .toMatchObject({ byteSize: 7, fileCount: 1 });
    await expect(fsp.lstat(missingWorkFilesRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fsp.lstat(missingAttachmentsRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('外部日志目录只统计直属 backend 日志，不把目录其余内容算成应用数据', async () => {
    const appDataRoot = await createTempRoot('external-logs-app-data');
    const workspaceRoot = await createTempRoot('external-logs-workspace');
    const diagnosticLogRoot = await createTempRoot('external-logs');
    await writeSizedFile(path.join(diagnosticLogRoot, 'backend-2026-08-03.log'), 11);
    await writeSizedFile(path.join(diagnosticLogRoot, 'unrelated.bin'), 13);
    await writeSizedFile(path.join(diagnosticLogRoot, 'nested', 'backend-fake.log'), 17);

    const inventory = await createLocalManagedStorageInventoryPort({
      appDataRoot,
      workspaceRoot,
      conversationWorkFilesRoot: path.join(appDataRoot, 'ConversationWorkDirectories'),
      attachmentRoots: [],
      diagnosticLogRoot,
      artifactsRoot: path.join(workspaceRoot, 'Artifacts', 'v1'),
    }).measure();

    expect(inventory.categories.find(category => category.kind === 'diagnostic_logs'))
      .toMatchObject({ byteSize: 11, fileCount: 1 });
    expect(inventory.categories.find(category => category.kind === 'application_data'))
      .toMatchObject({ byteSize: 0, fileCount: 0 });
    expect(inventory.total).toEqual({ byteSize: 11, fileCount: 1 });
  });

  it('AppData 与 Workspace 嵌套时由更具体的根拥有普通文件', async () => {
    const firstWorkspace = await createTempRoot('workspace-containing-app-data');
    const nestedAppData = path.join(firstWorkspace, 'private-app-data');
    await writeSizedFile(path.join(firstWorkspace, 'document.bin'), 5);
    await writeSizedFile(path.join(nestedAppData, 'config.bin'), 7);

    const appDataInsideWorkspace = await createLocalManagedStorageInventoryPort({
      appDataRoot: nestedAppData,
      workspaceRoot: firstWorkspace,
      conversationWorkFilesRoot: path.join(nestedAppData, 'ConversationWorkDirectories'),
      attachmentRoots: [],
      diagnosticLogRoot: path.join(firstWorkspace, 'logs'),
      artifactsRoot: path.join(firstWorkspace, 'Artifacts', 'v1'),
    }).measure();
    expect(Object.fromEntries(appDataInsideWorkspace.categories.map(category => [
      category.kind,
      category.byteSize,
    ]))).toMatchObject({ workspace: 5, application_data: 7 });

    const outerAppData = await createTempRoot('app-data-containing-workspace');
    const nestedWorkspace = path.join(outerAppData, 'workspace');
    await writeSizedFile(path.join(outerAppData, 'config.bin'), 11);
    await writeSizedFile(path.join(nestedWorkspace, 'document.bin'), 13);

    const workspaceInsideAppData = await createLocalManagedStorageInventoryPort({
      appDataRoot: outerAppData,
      workspaceRoot: nestedWorkspace,
      conversationWorkFilesRoot: path.join(outerAppData, 'ConversationWorkDirectories'),
      attachmentRoots: [],
      diagnosticLogRoot: path.join(nestedWorkspace, 'logs'),
      artifactsRoot: path.join(nestedWorkspace, 'Artifacts', 'v1'),
    }).measure();
    expect(Object.fromEntries(workspaceInsideAppData.categories.map(category => [
      category.kind,
      category.byteSize,
    ]))).toMatchObject({ workspace: 13, application_data: 11 });
  });
});
