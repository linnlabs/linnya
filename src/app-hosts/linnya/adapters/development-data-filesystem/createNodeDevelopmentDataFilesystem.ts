import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  DevelopmentDataDirectorySnapshot,
  DevelopmentDataFilesystemPort,
} from '../../application/development-data-lifecycle';

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function inspectDirectory(directory: string): Promise<DevelopmentDataDirectorySnapshot> {
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory()) {
      throw new Error(`[DevelopmentData] 预期目录，实际不是目录：${directory}`);
    }
    const entries = await fs.readdir(directory);
    return { exists: true, topLevelEntries: entries.sort() };
  } catch (error) {
    if (isMissingPath(error)) {
      return { exists: false, topLevelEntries: [] };
    }
    throw error;
  }
}

async function measureDirectory(directory: string): Promise<number> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await measureDirectory(entryPath);
      continue;
    }
    total += (await fs.lstat(entryPath)).size;
  }
  return total;
}

export function createNodeDevelopmentDataFilesystem(): DevelopmentDataFilesystemPort {
  const filesystem: DevelopmentDataFilesystemPort = {
    inspectDirectory,
    async readTextIfExists(filePath) {
      try {
        return await fs.readFile(filePath, 'utf8');
      } catch (error) {
        if (isMissingPath(error)) {
          return null;
        }
        throw error;
      }
    },
    async writeTextAtomically(filePath, content) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temporaryPath, filePath);
    },
    measureDirectory,
    async retireDirectory(source, retiredRoot, retiredName) {
      await fs.mkdir(retiredRoot, { recursive: true });
      const retiredPath = path.join(retiredRoot, retiredName);
      await fs.rename(source, retiredPath);
      return retiredPath;
    },
  };
  return Object.freeze(filesystem);
}
