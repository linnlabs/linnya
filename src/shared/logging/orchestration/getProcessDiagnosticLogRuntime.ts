import type { ProcessDiagnosticLogRuntime } from '../definitions/processDiagnosticLogRuntime';
import { createDiagnosticLogConsoleOutput } from './createDiagnosticLogConsoleOutput';

const PROCESS_DIAGNOSTIC_LOG_RUNTIME_KEY = '__linnyaProcessDiagnosticLogRuntimeV1__' as const;

interface DiagnosticLogGlobal {
  [PROCESS_DIAGNOSTIC_LOG_RUNTIME_KEY]?: ProcessDiagnosticLogRuntime;
}

function createProcessDiagnosticLogRuntime(): ProcessDiagnosticLogRuntime {
  return {
    // stdout 在 App Server 中承载 lifecycle protocol；诊断日志任何等级都只能写 stderr，
    // 包括 enableDiagnosticLogForwarding 安装前的模块初始化日志。
    writeConsoleRecord: createDiagnosticLogConsoleOutput(process.stderr),
    config: {
      minLevel: 0,
      enableConsole: true,
      // 文件 writer 必须由 App 生命周期显式启用。模块求值时自动写盘会让先加载的
      // bundle 抢走 owner，并在正式路径配置前创建遗留 backend.log。
      enableFile: false,
    },
    fileLoggingClosed: false,
  };
}

export function getProcessDiagnosticLogRuntime(): ProcessDiagnosticLogRuntime {
  const processGlobal: typeof globalThis & DiagnosticLogGlobal = globalThis;
  processGlobal[PROCESS_DIAGNOSTIC_LOG_RUNTIME_KEY] ??= createProcessDiagnosticLogRuntime();

  // 同一进程可能加载多个各自内联 Logger 的 bundle（例如磁盘插件）。进程级 registry
  // 保证这些 bundle 共享唯一 writer；App Server 与 Worker 属于独立进程/线程，只能
  // 通过正式日志 envelope 转发给 Desktop owner。
  return processGlobal[PROCESS_DIAGNOSTIC_LOG_RUNTIME_KEY];
}
