import type { LaunchOwnedPipeProcess } from '../../../../shared/process-runtime';
import {
  createMacOsProcessGroupOwnedPipeProcess,
} from '../macos';
import type {
  LocalProcessPlatformRuntime,
} from '../platform-runtime';
import {
  createWindowsJobOwnedPipeProcessLauncher,
} from '../windows';
import {
  createWindowsOwnedPipeNativeBindingLoader,
  type WindowsOwnedPipeNativeBindingLoaderOptions,
} from '../windows/functions/loadWindowsOwnedPipeNativeBinding';

/**
 * 把冻结的平台 owner 事实组合成普通 pipe launcher。这里不包含 Shell、Sandbox、
 * Qdrant 或审批语义，业务 adapter 只负责提供自己的 executable/argv/cwd/environment。
 */
export function createLocalProcessPlatformLauncher(
  runtime: LocalProcessPlatformRuntime,
): LaunchOwnedPipeProcess {
  if (runtime.platform === 'darwin') {
    if (process.platform !== 'darwin') {
      throw new Error('macOS local process runtime was configured on another platform');
    }
    return createMacOsProcessGroupOwnedPipeProcess;
  }

  if (process.platform !== 'win32') {
    throw new Error('Windows local process runtime was configured on another platform');
  }

  const loaderOptions: WindowsOwnedPipeNativeBindingLoaderOptions = {
    manifestPath: runtime.manifest_path,
    expectedRuntimeVersion: runtime.expected_runtime_version,
    expectedApplicationVersion: runtime.expected_application_version,
    trust: runtime.trust.kind === 'development'
      ? { kind: 'development' }
      : {
          kind: 'release',
          expectedPublisherIdentity: runtime.trust.expected_publisher_identity,
        },
  };
  const loader = createWindowsOwnedPipeNativeBindingLoader(loaderOptions);
  let launcher: LaunchOwnedPipeProcess | undefined;

  return async (launch, options) => {
    launcher ??= createWindowsJobOwnedPipeProcessLauncher(await loader.load());
    return launcher(launch, options);
  };
}
