import { isMainThread, parentPort } from 'node:worker_threads';
import { enableDiagnosticLogForwarding } from '../../../shared/logging/orchestration/diagnosticLogger';

if (isMainThread || !parentPort) throw new Error('Worker logging runtime requires a worker parent port');
const diagnosticPort = parentPort;
// 与业务 result 共用 parentPort 的既有 envelope，不污染控制 stdout，也不自行写盘。
enableDiagnosticLogForwarding(envelope => diagnosticPort.postMessage(envelope));

export { Logger } from '../../../shared/logging/orchestration/diagnosticLogger';
export type { PluginLoggerDetails, PluginLoggerPort, PluginLoggerConstructor } from '@linnya/plugin-host-contract/backend/loggingRuntime';
