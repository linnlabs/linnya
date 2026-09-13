type AppServerParentSignal = 'SIGINT' | 'SIGTERM';

export interface AppServerChildSignalOwnership {
  dispose(): void;
}

interface AppServerDiagnosticPipe {
  on(event: 'error', listener: (error: Error) => void): unknown;
  off(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * App Server 与前台 Host 同属终端进程组，但生命周期只归 parent supervisor。
 * child 忽略进程组广播，等待 parent 的 control shutdown；parent 崩溃时 pipe EOF
 * 仍会触发同一收口协议，避免 signal 与 control 同时争夺 Backend owner。
 */
export function installAppServerChildSignalOwnership(
  diagnosticPipe: AppServerDiagnosticPipe = process.stderr,
): AppServerChildSignalOwnership {
  const ignoreParentSignal = (): void => undefined;
  // parent 被强制终止后 stderr pipe 会先于 control shutdown 关闭。诊断输出丢失
  // 不能以未处理 EPIPE 打断数据库、descriptor 与 owned process 的正式收口。
  const ignoreDiagnosticPipeFailure = (_error: Error): void => undefined;
  const signals: readonly AppServerParentSignal[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) process.on(signal, ignoreParentSignal);
  diagnosticPipe.on('error', ignoreDiagnosticPipeFailure);

  let disposed = false;
  return Object.freeze({
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const signal of signals) process.off(signal, ignoreParentSignal);
      diagnosticPipe.off('error', ignoreDiagnosticPipeFailure);
    },
  });
}
