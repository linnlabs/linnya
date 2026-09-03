const PROCESS_GROUP_POLL_MS = 20;

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
  while (Date.now() < deadline) {
    if (!isMacOsProcessGroupAlive(processGroupId)) return true;
    await new Promise<void>(resolve => setTimeout(resolve, PROCESS_GROUP_POLL_MS));
  }
  return !isMacOsProcessGroupAlive(processGroupId);
}
