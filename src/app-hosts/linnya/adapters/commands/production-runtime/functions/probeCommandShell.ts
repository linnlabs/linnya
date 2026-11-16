import { execFile } from 'node:child_process';

import { getLogger } from 'src/shared/logger';

const logger = getLogger('CommandShellProbe');

/** 探测走异步子进程，不能阻塞 App Server 的启动协议、RPC 与退出消息。 */
export function probeCommandShell(input: {
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly kind: 'executable' | 'version';
}): Promise<string | undefined> {
  const startedAt = performance.now();
  return new Promise(resolve => {
    execFile(input.executablePath, [...input.argv], {
      encoding: 'utf8',
      env: input.environment,
      timeout: input.timeoutMs,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        // where 的退出码 1 只表示未安装可选 PowerShell 7，不是启动故障。
        if (input.kind !== 'executable' || error.code !== 1) {
          logger.warn('命令 Shell 探测失败', {
            kind: input.kind,
            durationMs: Math.round(performance.now() - startedAt),
            timeoutMs: input.timeoutMs,
            code: error.code ?? null,
            signal: error.signal ?? null,
            killed: error.killed ?? false,
          });
        }
        // 不记录环境变量、原始 stdout/stderr 或含宿主路径的 Error 对象。
        resolve(undefined);
        return;
      }
      const value = stdout.split(/\r?\n/u).map(line => line.trim()).find(Boolean);
      if (!value && input.kind === 'version') {
        logger.warn('命令 Shell 探测未返回版本', { kind: input.kind });
      }
      resolve(value);
    });
  });
}
