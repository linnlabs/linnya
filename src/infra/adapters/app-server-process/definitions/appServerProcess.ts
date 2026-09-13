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

export interface AppServerProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly expected: boolean;
}

export interface AppServerProcessSupervisor {
  start(): Promise<AppServerProcessIdentity>;
  /** start 后等待真实 child exit；宿主据此区分主动收口与运行期崩溃。 */
  waitForExit(): Promise<AppServerProcessExit>;
  request(
    method: string,
    payload: JsonValue,
    options?: AppServerRpcRequestOptions,
  ): Promise<JsonValue>;
  ping(): Promise<void>;
  shutdown(): Promise<void>;
}
