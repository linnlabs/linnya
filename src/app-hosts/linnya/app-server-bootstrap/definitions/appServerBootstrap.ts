import type { BackendBootstrapFacts } from '../../backend-runtime';
import type { HostProcessEnvironment } from '../../../../infra/adapters/command-runtime/environment';
import type { LocalProcessPlatformRuntime } from '../../../../infra/adapters/local-process-runtime/platform-runtime';

export const APP_SERVER_BOOTSTRAP_SCHEMA_VERSION = 5 as const;
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
  readonly host_kind: 'desktop' | 'cli_runtime';
  /** App Server 只接受这个直接 parent 的生命周期；reparent 视为 Host 已丢失。 */
  readonly host_process: { readonly pid: number };
  readonly backend_configuration: AppServerBackendConfiguration;
  readonly backend_facts: BackendBootstrapFacts;
  readonly command_host_environment: HostProcessEnvironment;
  /** Main 已验证的固定 Node 与平台进程 owner 事实；child 不读取 PATH/process.execPath 或重新探测签名。 */
  readonly headless_node_executable_path: string;
  readonly local_process_platform_runtime: LocalProcessPlatformRuntime;
  readonly host_capabilities: {
    /**
     * 交互式 CLI Host 在 API 对外可见前启用私有 pipe presenter，避免首个请求
     * 落入“Runtime 已 ready、终端 presenter 尚未接上”的竞态窗口。
     */
    readonly command_approval_presenter: { readonly available: boolean };
  };
  readonly text_measurement: {
    readonly use_browser_pretext: boolean;
    readonly use_harfbuzz: boolean;
    readonly worker_availability:
      | { readonly available: true }
      | { readonly available: false; readonly reason: string };
  };
}
