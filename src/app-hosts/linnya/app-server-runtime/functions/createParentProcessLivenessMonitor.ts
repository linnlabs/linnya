export interface ParentProcessLivenessMonitor {
  start(): void;
  dispose(): void;
}

/**
 * stdio pipe 在部分 Node/OS 进程树中不会随 launcher SIGKILL 及时产生 EOF。
 * App Server 只认 bootstrap 声明的直接 parent；一旦 reparent，就复用正式 shutdown。
 */
export function createParentProcessLivenessMonitor(input: {
  readonly expectedParentPid: number;
  readonly onParentLost: () => void;
  readonly readCurrentParentPid?: () => number;
  readonly isExpectedParentAlive?: (pid: number) => boolean;
  readonly intervalMs?: number;
}): ParentProcessLivenessMonitor {
  const readCurrentParentPid = input.readCurrentParentPid ?? (() => process.ppid);
  const isExpectedParentAlive = input.isExpectedParentAlive ?? isProcessAlive;
  const intervalMs = input.intervalMs ?? 500;
  if (!Number.isSafeInteger(input.expectedParentPid) || input.expectedParentPid <= 0) {
    throw new Error('App Server parent PID 必须是正整数');
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('App Server parent liveness interval 必须是正整数');
  }

  let timer: NodeJS.Timeout | null = null;
  let parentLost = false;
  const inspect = (): void => {
    if (parentLost) return;
    if (
      readCurrentParentPid() === input.expectedParentPid
      && isExpectedParentAlive(input.expectedParentPid)
    ) return;
    parentLost = true;
    if (timer) clearInterval(timer);
    timer = null;
    input.onParentLost();
  };
  return Object.freeze({
    start() {
      if (timer || parentLost) return;
      inspect();
      if (parentLost) return;
      timer = setInterval(inspect, intervalMs);
      timer.unref();
    },
    dispose() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    // EPERM 表示进程存在但当前身份不能发信号；其余平台错误都按 parent 已丢失处理。
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}
