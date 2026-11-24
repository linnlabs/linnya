import fs from 'node:fs';
import path from 'node:path';

const STAGING_DIRECTORY = /^\.install-.+\.(?<pid>\d+)\.\d+$/u;

/** 安装临时目录名带进程号：同目录可能有另一个进程（例如 CLI）正在安装。 */
export function createInstallStagingPath(installDirectory: string, version: string): string {
  return path.join(installDirectory, `.install-${version}.${process.pid}.${Date.now()}`);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM 表示进程存在但无权发信号。
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/** 清掉被强制结束的安装留下的临时目录；进程仍在的一律不动。 */
export function removeAbandonedInstallStaging(installDirectory: string): void {
  if (!fs.existsSync(installDirectory)) return;
  for (const entry of fs.readdirSync(installDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pid = STAGING_DIRECTORY.exec(entry.name)?.groups?.pid;
    if (pid === undefined || isProcessRunning(Number(pid))) continue;
    fs.rmSync(path.join(installDirectory, entry.name), { recursive: true, force: true });
  }
}
