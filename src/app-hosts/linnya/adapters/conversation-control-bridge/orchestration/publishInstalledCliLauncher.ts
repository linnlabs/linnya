import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { InstalledCliLauncher } from '../functions/createInstalledCliLauncher';

async function readCurrentContent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * 把 `linnya` 入口写到用户级固定位置。
 *
 * 内容没变就不写：外部 Agent 可能正在执行这个文件，Windows 上改名覆盖一个正被打开的批处理会失败，
 * 而绝大多数启动（同一安装位置）根本不需要改它。内容变了才原子替换。
 *
 * @returns 本次是否写入了新内容。
 */
export async function publishInstalledCliLauncher(launcher: InstalledCliLauncher): Promise<boolean> {
  if (await readCurrentContent(launcher.filePath) === launcher.content) return false;
  const directory = path.dirname(launcher.filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(launcher.filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    // 入口不含凭据，但只应由当前用户改写；0755 让该用户启动的任何 Agent 都能执行它。
    await fs.writeFile(temporary, launcher.content, { encoding: 'utf8', mode: 0o755, flag: 'wx' });
    await fs.rename(temporary, launcher.filePath);
  } catch (error: unknown) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
  return true;
}
