import type { Writable } from 'node:stream';

import type { DiagnosticLogRecord } from '../definitions/diagnosticLogContract';

export function createDiagnosticLogConsoleOutput(stream: Writable): (record: DiagnosticLogRecord) => void {
  let unavailable = false;
  // 输出端的 error 可晚于 write 回调到达；只加 try/catch 或临时监听会漏掉异步 EPIPE。
  // 监听器与进程级输出端同寿命，只隔离终端故障，不拦截进程级业务异常。
  stream.on('error', () => { unavailable = true; });
  return record => {
    if (unavailable) return;
    try {
      stream.write(`${record.line}\n`, error => {
        if (error) unavailable = true;
      });
    } catch {
      // TTY/文件输出也可能同步抛错。当前输出端熔断，文件日志仍由独立 writer 接收。
      unavailable = true;
    }
  };
}
