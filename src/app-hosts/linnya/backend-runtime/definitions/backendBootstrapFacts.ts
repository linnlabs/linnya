import type { RuntimePathRoots } from '../../../../shared/runtime-paths';
import type { DistributionIdentity } from '../../../../shared/distribution-identity';

/**
 * Backend owner 启动时冻结的只读宿主事实。这里只允许 data-only 字段，不能携带 Electron
 * 对象、环境变量袋、函数或可变路径解析器，以便同一合同随后跨 App Server 进程边界传递。
 */
export interface BackendBootstrapFacts {
  readonly applicationVersion: string;
  readonly applicationExecutablePath: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
  readonly packaged: boolean;
  readonly distributionIdentity: DistributionIdentity;
  readonly resourcesPath: string;
  readonly mainBundleDirectory: string;
  readonly runtimePathRoots: RuntimePathRoots;
  readonly exposeProviderOutboundDebugRoutes: boolean;
}
