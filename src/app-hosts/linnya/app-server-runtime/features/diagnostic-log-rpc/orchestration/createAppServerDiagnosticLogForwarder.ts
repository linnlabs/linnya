import type { DiagnosticLogEnvelope } from '../../../../../../shared/logging';
import type { AppServerRpcPeer } from '../../../../app-server-rpc';
import { APP_SERVER_DIAGNOSTIC_LOG_WRITE_RPC_METHOD } from '../definitions/appServerDiagnosticLogRpc';
import { encodeAppServerDiagnosticLogPayload } from '../functions/appServerDiagnosticLogRpcCodec';

const DIAGNOSTIC_LOG_RPC_TIMEOUT_MS = 2_000;

/**
 * Logger API 是同步的，因此这里只投递异步 RPC。RPC 自身有 pending 上限；日志拥塞时允许丢日志，
 * 绝不能反向阻塞 Backend 业务或 Electron Main 交互。
 */
export function createAppServerDiagnosticLogForwarder(
  rpc: Pick<AppServerRpcPeer, 'request'>,
  onFailure?: (error: Error) => void,
): (envelope: DiagnosticLogEnvelope) => void {
  let failureReported = false;
  return envelope => {
    void rpc.request(
      APP_SERVER_DIAGNOSTIC_LOG_WRITE_RPC_METHOD,
      encodeAppServerDiagnosticLogPayload(envelope),
      { timeoutMs: DIAGNOSTIC_LOG_RPC_TIMEOUT_MS },
    ).catch((error: unknown) => {
      if (failureReported || !onFailure) return;
      failureReported = true;
      onFailure(error instanceof Error ? error : new Error(String(error)));
    });
  };
}
