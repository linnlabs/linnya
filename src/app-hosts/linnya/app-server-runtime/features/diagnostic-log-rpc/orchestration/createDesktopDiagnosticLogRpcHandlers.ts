import type {
  AppServerRpcHandler,
  AppServerRpcHandlerRegistry,
} from '../../../../app-server-rpc';
import type { DiagnosticLogRecord } from '../../../../../../shared/logging';
import { APP_SERVER_DIAGNOSTIC_LOG_WRITE_RPC_METHOD } from '../definitions/appServerDiagnosticLogRpc';
import { parseAppServerDiagnosticLogPayload } from '../functions/appServerDiagnosticLogRpcCodec';

export function createDesktopDiagnosticLogRpcHandlers(input: {
  readonly writeRecord: (record: DiagnosticLogRecord) => void;
}): AppServerRpcHandlerRegistry {
  return new Map<string, AppServerRpcHandler>([
    [APP_SERVER_DIAGNOSTIC_LOG_WRITE_RPC_METHOD, payload => {
      input.writeRecord(parseAppServerDiagnosticLogPayload(payload).record);
      return null;
    }],
  ]);
}
