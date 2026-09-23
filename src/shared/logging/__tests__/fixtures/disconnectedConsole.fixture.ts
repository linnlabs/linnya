import { Console } from 'node:console';
import { setImmediate } from 'node:timers/promises';

import { enableFileLogging, Logger, shutdownDiagnosticLogging } from '../../../logger';

// Electron 的全局 console 会传播写入错误；普通 Node 默认忽略错误，不能直接用它复现。
globalThis.console = new Console({
  stdout: process.stdout,
  stderr: process.stderr,
  ignoreErrors: false,
});

const logPath = process.argv[2];
if (!logPath) throw new Error('fixture requires a log path');
enableFileLogging(true, logPath);
const logger = new Logger('disconnected-console');
// stderr 本身就是故障对象，失败证据通过独立 IPC 返回；monitor 不改变异常退出行为。
process.once('uncaughtExceptionMonitor', error => {
  process.send?.({ failure: error.stack });
});

process.once('message', async () => {
  // 父进程已经关闭两条管道。首轮触发真实 EPIPE，后续写入覆盖已经失败的流。
  for (let iteration = 0; iteration < 3; iteration += 1) {
    logger.debug(`debug-${iteration}`);
    logger.info(`info-${iteration}`);
    logger.warn(`warn-${iteration}`);
    logger.error(`error-${iteration}`);
    await setImmediate();
  }
  const result = await shutdownDiagnosticLogging();
  if (!result?.complete) throw new Error('file log did not drain');
  process.disconnect();
});
process.send?.('ready');
