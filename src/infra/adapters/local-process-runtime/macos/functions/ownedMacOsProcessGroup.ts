import { execFile } from 'node:child_process';

const PROCESS_GROUP_FIRST_POLL_MS = 1;
const PROCESS_GROUP_POLL_MS = 20;
const PROCESS_GROUP_LISTING_EXECUTABLE = '/usr/bin/pgrep';
const PROCESS_GROUP_LISTING_DEADLINE_MS = 1_000;

/** 只接受由十进制 PID 组成的完整 pgrep 输出；任何其他内容都不是成员事实。 */
export function parseMacOsProcessGroupListing(stdout: string): readonly number[] | null {
  const lines = stdout.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const members: number[] = [];
  for (const line of lines) {
    if (!/^[1-9][0-9]*$/u.test(line)) return null;
    const pid = Number(line);
    if (!Number.isSafeInteger(pid)) return null;
    members.push(pid);
  }
  return members;
}

/**
 * 列出进程组当前成员。无法得到完整列表时返回 null，调用方必须保持保守收树路径；
 * pgrep 以退出码 1 表示没有匹配进程。
 */
export function listMacOsProcessGroupMembers(
  processGroupId: number,
): Promise<readonly number[] | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        PROCESS_GROUP_LISTING_EXECUTABLE,
        ['-g', String(processGroupId)],
        { env: {}, timeout: PROCESS_GROUP_LISTING_DEADLINE_MS },
        (error, stdout) => {
          if (error) {
            resolve(error.code === 1 && stdout === '' ? [] : null);
            return;
          }
          resolve(parseMacOsProcessGroupListing(stdout));
        },
      );
    } catch {
      resolve(null);
    }
  });
}

export function isMacOsProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'ESRCH') return false;
      // Seatbelt 可能让同用户进程组暂时返回 EPERM；这不是 tree-empty 证明。
      if (error.code === 'EPERM') return true;
    }
    throw error;
  }
}

export function signalMacOsProcessGroupIfAlive(
  processGroupId: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    // 零号探测与 signal 之间允许进程组自然消失，ESRCH 等价于目标已完成。
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}

export async function waitForMacOsProcessGroupEmpty(
  processGroupId: number,
  deadlineMs: number,
): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  let pollMs = PROCESS_GROUP_FIRST_POLL_MS;
  while (Date.now() < deadline) {
    if (!isMacOsProcessGroupAlive(processGroupId)) return true;
    await new Promise<void>(resolve => setTimeout(resolve, pollMs));
    // 正常收尾通常几毫秒内归零；指数退避到固定间隔，长等待时不增加探测频率。
    pollMs = Math.min(pollMs * 2, PROCESS_GROUP_POLL_MS);
  }
  return !isMacOsProcessGroupAlive(processGroupId);
}
