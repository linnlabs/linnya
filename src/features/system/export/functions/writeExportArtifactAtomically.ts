import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
}

/**
 * staging 与目标文件位于同一目录，保证最终 rename 不跨文件系统。
 * 用户在保存框确认覆盖后，rename 才一次性发布完整 artifact。
 */
export async function writeExportArtifactAtomically(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const stagingPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.tmp`,
  );

  try {
    await fs.writeFile(stagingPath, bytes, { flag: 'wx' });
    await fs.rename(stagingPath, filePath);
  } catch (error) {
    await fs.unlink(stagingPath).catch((cleanupError: unknown) => {
      if (!isMissingFileError(cleanupError)) {
        throw cleanupError;
      }
    });
    throw error;
  }
}
