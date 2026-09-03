import fs from 'fs/promises';

const grantedReadRealPaths = new Set<string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function clearSessionReadGrantsForTests(): void {
  grantedReadRealPaths.clear();
}

export function isReadGranted(realPath: string): boolean {
  return grantedReadRealPaths.has(realPath);
}

export async function issueReadGrant(filePath: string): Promise<string | null> {
  const realPath = await fs.realpath(filePath);
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    return null;
  }

  grantedReadRealPaths.add(realPath);
  return realPath;
}

export async function issueReadGrantsFromDialogResult(dialogResult: unknown): Promise<void> {
  if (!isRecord(dialogResult)) {
    return;
  }

  if (dialogResult.canceled === true || !Array.isArray(dialogResult.filePaths)) {
    return;
  }

  for (const filePath of dialogResult.filePaths) {
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      continue;
    }

    try {
      await issueReadGrant(filePath);
    } catch {
      // Dialog 结果理论上来自系统文件选择器；这里忽略已消失或非文件路径，不扩大授权面。
    }
  }
}
