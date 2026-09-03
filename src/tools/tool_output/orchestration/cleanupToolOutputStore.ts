import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { TOOL_OUTPUT_MANIFEST_FILE_NAME } from '../definitions/toolOutputBlob';

export interface ToolOutputStoreCleanupStats {
  readonly scanned: number;
  readonly deleted: number;
  readonly failed: number;
}

export interface ToolOutputStoreCleanupLogger {
  warn(message: string): void;
}

function readNodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

async function existingDirectory(pathname: string): Promise<string | null> {
  let stat;
  try {
    stat = await fsp.lstat(pathname);
  } catch (error: unknown) {
    if (readNodeErrorCode(error) === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`预期目录的路径形状非法: ${pathname}`);
  }
  return pathname;
}

async function listChildDirectories(pathname: string): Promise<string[]> {
  let entries;
  try {
    entries = await fsp.readdir(pathname, { withFileTypes: true });
  } catch (error: unknown) {
    if (readNodeErrorCode(error) === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pathname, entry.name));
}

async function listToolOutputBlobDirectories(workspaceRoot: string): Promise<string[]> {
  const conversationsRoot = await existingDirectory(path.join(
    workspaceRoot,
    'Artifacts',
    'v1',
    'conversations',
  ));
  if (!conversationsRoot) return [];

  const result: string[] = [];
  for (const conversationDirectory of await listChildDirectories(conversationsRoot)) {
    const instancesRoot = await existingDirectory(path.join(conversationDirectory, 'instances'));
    if (!instancesRoot) continue;
    for (const instanceDirectory of await listChildDirectories(instancesRoot)) {
      const blobsDirectory = await existingDirectory(path.join(
        instanceDirectory,
        'tool_output',
        'blobs',
      ));
      if (blobsDirectory) result.push(blobsDirectory);
    }
  }
  return result;
}

async function removePublishedBlobDirectory(directoryPath: string): Promise<void> {
  const manifestPath = path.join(directoryPath, TOOL_OUTPUT_MANIFEST_FILE_NAME);
  try {
    // manifest 是可见性事实，先移除它，后续即使 Windows 删除正文失败，reader 也不会读半删 artifact。
    await fsp.unlink(manifestPath);
  } catch (error: unknown) {
    if (readNodeErrorCode(error) !== 'ENOENT') throw error;
  }
  await fsp.rm(directoryPath, { recursive: true });
}

async function cleanupBlobRoot(input: {
  readonly blobsDirectory: string;
  readonly now: number;
  readonly retentionMs: number;
  readonly logger: ToolOutputStoreCleanupLogger;
}): Promise<ToolOutputStoreCleanupStats> {
  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  let entries;
  try {
    entries = await fsp.readdir(input.blobsDirectory, { withFileTypes: true });
  } catch (error: unknown) {
    if (readNodeErrorCode(error) === 'ENOENT') return { scanned, deleted, failed };
    throw error;
  }

  for (const entry of entries) {
    const fullPath = path.join(input.blobsDirectory, entry.name);
    const isLegacyBlob = entry.isFile() && /^[a-f0-9]{16}\.json$/.test(entry.name);
    const isPending = entry.isDirectory() && entry.name.startsWith('.pending-');
    const isCurrentBlob = entry.isDirectory() && /^[a-f0-9]{16}$/.test(entry.name);
    if (!isLegacyBlob && !isPending && !isCurrentBlob) continue;
    scanned += 1;

    try {
      if (isPending) {
        // 该函数只在 Agent admission 开放前的启动维护运行，因此所有 pending 都属于旧进程。
        await fsp.rm(fullPath, { recursive: true });
        deleted += 1;
        continue;
      }
      if (isLegacyBlob) {
        const stat = await fsp.lstat(fullPath);
        if (input.now - stat.mtimeMs <= input.retentionMs) continue;
        await fsp.unlink(fullPath);
        deleted += 1;
        continue;
      }

      const manifestPath = path.join(fullPath, TOOL_OUTPUT_MANIFEST_FILE_NAME);
      let manifestStat;
      try {
        manifestStat = await fsp.lstat(manifestPath);
      } catch (error: unknown) {
        if (readNodeErrorCode(error) !== 'ENOENT') throw error;
        // manifest 从未发布的内容地址不可见，启动时可直接回收整个 orphan。
        await fsp.rm(fullPath, { recursive: true });
        deleted += 1;
        continue;
      }
      if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
        throw new Error('manifest 不是普通文件');
      }
      if (input.now - manifestStat.mtimeMs <= input.retentionMs) continue;
      await removePublishedBlobDirectory(fullPath);
      deleted += 1;
    } catch (error: unknown) {
      failed += 1;
      input.logger.warn(
        `ToolOutputStore 清理失败: path=${fullPath}, `
        + `err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return { scanned, deleted, failed };
}

/** 启动期 best-effort 清理；读取正文不会触碰 manifest mtime。 */
export async function cleanupToolOutputStoreByTime(input: {
  readonly logger: ToolOutputStoreCleanupLogger;
  readonly retentionDays: number;
  readonly workspaceRoot: string;
  readonly now?: number;
}): Promise<ToolOutputStoreCleanupStats> {
  const retentionMs = Math.max(1, Math.floor(input.retentionDays)) * 24 * 60 * 60 * 1000;
  const now = input.now ?? Date.now();
  const total = { scanned: 0, deleted: 0, failed: 0 };
  let blobDirectories: string[];
  try {
    blobDirectories = await listToolOutputBlobDirectories(input.workspaceRoot);
  } catch (error: unknown) {
    total.failed += 1;
    input.logger.warn(
      `ToolOutputStore 扫描失败: root=${input.workspaceRoot}, `
      + `err=${error instanceof Error ? error.message : String(error)}`,
    );
    return total;
  }
  for (const blobsDirectory of blobDirectories) {
    try {
      const result = await cleanupBlobRoot({
        blobsDirectory,
        now,
        retentionMs,
        logger: input.logger,
      });
      total.scanned += result.scanned;
      total.deleted += result.deleted;
      total.failed += result.failed;
    } catch (error: unknown) {
      total.failed += 1;
      input.logger.warn(
        `ToolOutputStore 扫描失败: root=${blobsDirectory}, `
        + `err=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return total;
}
