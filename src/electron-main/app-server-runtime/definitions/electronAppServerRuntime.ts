import type {
  BackendRendererRequestRpcGatewayPort,
} from '../../../app-hosts/linnya/adapters/backend-renderer-requests';
import type {
  CommandDesktopRpcGateways,
} from '../../../app-hosts/linnya/adapters/commands/renderer-rpc';
import type {
  AppServerProcessIdentity,
  AppServerProcessSupervisor,
} from '../../../infra/adapters/app-server-process';
import type {
  AppServerActivityGatewayPort,
} from '../../../app-hosts/linnya/app-server-runtime/features/activity-rpc';

export interface ElectronAppServerRuntime {
  readonly process: AppServerProcessSupervisor;
  readonly rendererRequests: BackendRendererRequestRpcGatewayPort;
  readonly commands: CommandDesktopRpcGateways;
  readonly activity: AppServerActivityGatewayPort;
  start(): Promise<AppServerProcessIdentity>;
  shutdown(): Promise<void>;
}
