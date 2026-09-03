import type { RuntimePathRoots } from '../definitions/runtimePathRoots';
import { createRuntimePathRoots } from '../functions/createRuntimePathRoots';

const RUNTIME_PATH_ROOTS_KEY = '__LINNYA_RUNTIME_PATH_ROOTS__';

type RuntimePathRootStore = typeof globalThis & {
  [RUNTIME_PATH_ROOTS_KEY]?: RuntimePathRoots;
};

/**
 * 为当前 Main、App Server 或 Worker 运行域安装唯一一份路径事实。
 *
 * 同值重复安装允许启动编排保持幂等；不同值代表两个 owner 正在争夺同一运行域，必须失败。
 */
export function installRuntimePathRoots(input: RuntimePathRoots): RuntimePathRoots {
  const store = globalThis as RuntimePathRootStore;
  const roots = createRuntimePathRoots(input);
  const installed = store[RUNTIME_PATH_ROOTS_KEY];
  if (installed) {
    if (!haveSameRoots(installed, roots)) {
      throw new Error('当前运行域已经绑定另一份 Runtime path roots');
    }
    return installed;
  }
  store[RUNTIME_PATH_ROOTS_KEY] = roots;
  return roots;
}

export function readInstalledRuntimePathRoots(): RuntimePathRoots | undefined {
  return (globalThis as RuntimePathRootStore)[RUNTIME_PATH_ROOTS_KEY];
}

function haveSameRoots(left: RuntimePathRoots, right: RuntimePathRoots): boolean {
  return (
    left.developmentRoot === right.developmentRoot &&
    left.appDataRoot === right.appDataRoot &&
    left.workspaceRoot === right.workspaceRoot &&
    left.workspaceRootIsCustom === right.workspaceRootIsCustom
  );
}
