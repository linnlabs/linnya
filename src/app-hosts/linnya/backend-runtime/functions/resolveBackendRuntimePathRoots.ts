import path from 'node:path';

import { createRuntimePathRoots, resolveDevelopmentInstancePaths, type RuntimePathRoots } from '../../../../shared/runtime-paths';

export interface BackendRuntimePathRootInput {
  readonly developmentRoot: string;
  readonly userDataDirectory: string;
  /**
   * 正式版用户数据根，由 Desktop Host 用 `resolveProductionDataRoot` 按平台解析。
   * 开发模式不读取它：开发数据固定在实例的 `_dev_data`。
   */
  readonly productionDataRoot?: string;
  readonly developmentMode: boolean;
  readonly workspaceRootOverride?: string;
  readonly developmentInstanceRootOverride?: string;
}

/**
 * App Host 在启动时把平台目录和开发模式收敛为纯数据事实。
 * App Server 只接收结果，不能再次读取 Electron 或根据自己的 cwd 猜路径。
 *
 * 开发与正式版布局相同：AppData 与默认 Workspace 是同一个目录，数据库、受管文件、
 * 会话工作目录都在其中；只有显式 Workspace 覆盖会把 Workspace 移到别处。
 */
export function resolveBackendRuntimePathRoots(
  input: BackendRuntimePathRootInput
): RuntimePathRoots {
  const developmentRoot = path.resolve(input.developmentRoot);
  const dataRoot = input.developmentMode
    ? resolveDevelopmentInstancePaths(developmentRoot, input.developmentInstanceRootOverride).appDataRoot
    : requireProductionDataRoot(input.productionDataRoot);
  const workspaceRootOverride = input.workspaceRootOverride?.trim();

  return createRuntimePathRoots({
    developmentRoot,
    profileRoot: path.resolve(input.userDataDirectory),
    appDataRoot: dataRoot,
    workspaceRoot: workspaceRootOverride
      ? path.resolve(developmentRoot, workspaceRootOverride)
      : dataRoot,
    workspaceRootIsCustom: Boolean(workspaceRootOverride),
  });
}

function requireProductionDataRoot(value: string | undefined): string {
  if (!value || !path.isAbsolute(value)) {
    throw new Error('正式运行缺少绝对路径的用户数据根（productionDataRoot）');
  }
  return path.resolve(value);
}
