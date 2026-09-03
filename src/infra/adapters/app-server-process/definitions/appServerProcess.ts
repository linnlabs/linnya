import type { JsonValue } from '@app/schemas';
import type { AppServerRpcRequestOptions } from '../../../../app-hosts/linnya/app-server-rpc';

export interface AppServerProcessLaunch {
  readonly executablePath: string;
  readonly entryPath: string;
  readonly entryArguments?: readonly string[];
  readonly workingDirectory: string;
  /** 由 composition root 提供完整白名单环境；adapter 不继承或猜测 process.env。 */
  readonly environment: Readonly<Record<string, string>>;
  /** 已由 App Host 严格编码的一次性 bootstrap frame，通过独立 fd 3 传递。 */
  readonly bootstrapBytes: Uint8Array;
}

export interface AppServerProcessIdentity {
  readonly daemonEpoch: string;
  readonly pid: number;
  readonly applicationVersion: string;
  readonly apiPort: number;
  readonly rendererSessionToken: string;
  readonly databaseReady: true;
}

export interface AppServerProcessSupervisor {
  start(): Promise<AppServerProcessIdentity>;
  request(
    method: string,
    payload: JsonValue,
    options?: AppServerRpcRequestOptions,
  ): Promise<JsonValue>;
  ping(): Promise<void>;
  shutdown(): Promise<void>;
}
