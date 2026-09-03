import type { BackendBootstrapFacts } from '../../backend-runtime';
import type { HostProcessEnvironment } from '../../../../infra/adapters/command-runtime/environment';
import type { LocalProcessPlatformRuntime } from '../../../../infra/adapters/local-process-runtime/platform-runtime';

export const APP_SERVER_BOOTSTRAP_SCHEMA_VERSION = 1 as const;
export const APP_SERVER_BOOTSTRAP_MAX_FRAME_BYTES = 1024 * 1024;

export interface AppServerBackendConfiguration {
  readonly qdrant: {
    readonly host: string;
    readonly port: number;
  };
  readonly server: {
    readonly port: number;
  };
}

/** App Server 唯一启动帧；这里只能包含可序列化事实，不能携带 Desktop port 或函数。 */
export interface AppServerBootstrap {
  readonly schema_version: typeof APP_SERVER_BOOTSTRAP_SCHEMA_VERSION;
  readonly backend_configuration: AppServerBackendConfiguration;
  readonly backend_facts: BackendBootstrapFacts;
  readonly command_host_environment: HostProcessEnvironment;
  /** Main 已验证的固定 Node 与平台进程 owner 事实；child 不读取 PATH/process.execPath 或重新探测签名。 */
  readonly headless_node_executable_path: string;
  readonly local_process_platform_runtime: LocalProcessPlatformRuntime;
  readonly text_measurement: {
    readonly use_browser_pretext: boolean;
    readonly use_harfbuzz: boolean;
    readonly worker_availability:
      | { readonly available: true }
      | { readonly available: false; readonly reason: string };
  };
}
