import { promises as fsp } from 'node:fs';
import path from 'node:path';

import {
  STORAGE_SPACE_CATEGORY_KINDS,
  type ManagedStorageInventoryPort,
  type StorageSpaceCategoryKind,
  type StorageSpaceCategoryUsage,
} from '../../../../app-hosts/linnya/application/storage-space';

interface LocalManagedStorageRoots {
  readonly appDataRoot: string;
  readonly workspaceRoot: string;
  readonly conversationWorkFilesRoot: string;
  readonly attachmentRoots: readonly string[];
  readonly diagnosticLogRoot: string;
  readonly artifactsRoot: string;
}

interface MutableUsage {
  byteSize: number;
  fileCount: number;
}

function readNodeErrorCode(error: unknown): string | undefined {
  return error instanceof Error
    && 'code' in error
    && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function isMissing(error: unknown): boolean {
  return readNodeErrorCode(error) === 'ENOENT';
}

function isWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function normalizeRoots(roots: readonly string[]): readonly string[] {
  const unique = [...new Set(roots.map(root => path.resolve(root)))];
  return Object.freeze(unique.filter((candidate, index) => (
    !unique.some((other, otherIndex) => otherIndex !== index && isWithin(candidate, other))
  )));
}

function isTemporaryOutputPath(candidate: string, artifactsRoot: string): boolean {
  if (!isWithin(candidate, artifactsRoot)) return false;
  const segments = path.relative(artifactsRoot, candidate).split(path.sep);
  const isRawCommandOutput = segments.length >= 6
    && /^conversation_[a-f0-9]{64}$/.test(segments[0] ?? '')
    && segments[1] === 'instances'
    && /^instance_[a-f0-9]{64}$/.test(segments[2] ?? '')
    && segments[3] === 'command-output';
  const isToolOutput = segments.length >= 7
    && segments[0] === 'conversations'
    && segments[2] === 'instances'
    && segments[4] === 'tool_output';
  return isRawCommandOutput || isToolOutput;
}

function isManagedDiagnosticLog(candidate: string, logRoot: string): boolean {
  if (path.dirname(candidate) !== logRoot) return false;
  const name = path.basename(candidate);
  return name.startsWith('backend-') && name.endsWith('.log');
}

function classifyPath(candidate: string, roots: LocalManagedStorageRoots): StorageSpaceCategoryKind {
  if (isWithin(candidate, roots.conversationWorkFilesRoot)) {
    return 'conversation_work_files';
  }
  if (roots.attachmentRoots.some(root => isWithin(candidate, root))) {
    return 'attachments';
  }
  if (isManagedDiagnosticLog(candidate, roots.diagnosticLogRoot)) {
    return 'diagnostic_logs';
  }
  if (isTemporaryOutputPath(candidate, roots.artifactsRoot)) {
    return 'temporary_outputs';
  }
  const withinWorkspace = isWithin(candidate, roots.workspaceRoot);
  const withinAppData = isWithin(candidate, roots.appDataRoot);
  if (withinWorkspace && withinAppData) {
    // 两个根嵌套时由更具体的根拥有普通文件；开发态同根沿用 Workspace 口径。
    return roots.appDataRoot !== roots.workspaceRoot
      && isWithin(roots.appDataRoot, roots.workspaceRoot)
      ? 'application_data'
      : 'workspace';
  }
  if (withinWorkspace) {
    return 'workspace';
  }
  return 'application_data';
}

async function measureManagedDiagnosticLogs(input: {
  readonly roots: LocalManagedStorageRoots;
  readonly usage: Map<StorageSpaceCategoryKind, MutableUsage>;
}): Promise<void> {
  let entries;
  try {
    entries = await fsp.readdir(input.roots.diagnosticLogRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissing(error)) return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(input.roots.diagnosticLogRoot, entry.name);
    if (!entry.isFile() || !isManagedDiagnosticLog(entryPath, input.roots.diagnosticLogRoot)) {
      continue;
    }
    let stat;
    try {
      stat = await fsp.lstat(entryPath);
    } catch (error: unknown) {
      if (isMissing(error)) continue;
      throw error;
    }
    const current = input.usage.get('diagnostic_logs');
    if (!current) throw new Error('missing storage category accumulator: diagnostic_logs');
    current.byteSize += stat.size;
    current.fileCount += 1;
  }
}

async function measureTree(input: {
  readonly directoryPath: string;
  readonly roots: LocalManagedStorageRoots;
  readonly usage: Map<StorageSpaceCategoryKind, MutableUsage>;
}): Promise<void> {
  let entries;
  try {
    entries = await fsp.readdir(input.directoryPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (isMissing(error)) return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = path.join(input.directoryPath, entry.name);
    let stat;
    try {
      stat = await fsp.lstat(entryPath);
    } catch (error: unknown) {
      if (isMissing(error)) continue;
      throw error;
    }

    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      await measureTree({ ...input, directoryPath: entryPath });
      continue;
    }

    const category = classifyPath(entryPath, input.roots);
    const current = input.usage.get(category);
    if (!current) {
      throw new Error(`missing storage category accumulator: ${category}`);
    }
    current.byteSize += stat.size;
    current.fileCount += 1;
  }
}

/**
 * AppData、Workspace 和附件根可能重合或互相嵌套，因此先压成最小根集合再遍历。
 * 日志目录只拥有直属 backend 日志，不能因为自定义路径或现有 cwd 回退而取得整棵目录的所有权。
 */
export function createLocalManagedStorageInventoryPort(
  input: LocalManagedStorageRoots,
): ManagedStorageInventoryPort {
  const roots: LocalManagedStorageRoots = Object.freeze({
    appDataRoot: path.resolve(input.appDataRoot),
    workspaceRoot: path.resolve(input.workspaceRoot),
    conversationWorkFilesRoot: path.resolve(input.conversationWorkFilesRoot),
    attachmentRoots: Object.freeze(input.attachmentRoots.map(root => path.resolve(root))),
    diagnosticLogRoot: path.resolve(input.diagnosticLogRoot),
    artifactsRoot: path.resolve(input.artifactsRoot),
  });
  const traversalRoots = normalizeRoots([
    roots.appDataRoot,
    roots.workspaceRoot,
    ...roots.attachmentRoots,
  ]);
  const diagnosticLogsCoveredByTraversal = traversalRoots.some(root => (
    isWithin(roots.diagnosticLogRoot, root)
  ));

  return Object.freeze({
    async measure() {
      const usage = new Map<StorageSpaceCategoryKind, MutableUsage>(
        STORAGE_SPACE_CATEGORY_KINDS.map(kind => [kind, { byteSize: 0, fileCount: 0 }]),
      );
      for (const root of traversalRoots) {
        await measureTree({ directoryPath: root, roots, usage });
      }
      if (!diagnosticLogsCoveredByTraversal) {
        await measureManagedDiagnosticLogs({ roots, usage });
      }

      const categories: readonly StorageSpaceCategoryUsage[] = Object.freeze(
        STORAGE_SPACE_CATEGORY_KINDS.map((kind) => {
          const measured = usage.get(kind);
          if (!measured) throw new Error(`missing storage category result: ${kind}`);
          return Object.freeze({ kind, ...measured });
        }),
      );
      return Object.freeze({
        categories,
        total: Object.freeze({
          byteSize: categories.reduce((total, category) => total + category.byteSize, 0),
          fileCount: categories.reduce((total, category) => total + category.fileCount, 0),
        }),
      });
    },
  });
}
