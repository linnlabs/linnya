import path from 'node:path';

import { createRuntimePathRoots, type RuntimePathRoots } from '../../../shared/runtime-paths';

export interface BackendRuntimePathRootInput {
  readonly developmentRoot: string;
  readonly userDataDirectory: string;
  readonly documentsDirectory: string;
  readonly developmentMode: boolean;
  readonly workspaceRootOverride?: string;
}

/**
 * Desktop Host 在启动时把 Electron 目录和开发模式收敛为纯数据事实。
 * App Server 只接收结果，不能再次读取 Electron 或根据自己的 cwd 猜路径。
 */
export function resolveBackendRuntimePathRoots(
  input: BackendRuntimePathRootInput
): RuntimePathRoots {
  const developmentRoot = path.resolve(input.developmentRoot);
  const developmentDataRoot = path.join(developmentRoot, '_dev_data');
  const workspaceRootOverride = input.workspaceRootOverride?.trim();

  return createRuntimePathRoots({
    developmentRoot,
    appDataRoot: input.developmentMode
      ? developmentDataRoot
      : path.join(input.userDataDirectory, 'AIService'),
    workspaceRoot: workspaceRootOverride
      ? path.resolve(developmentRoot, workspaceRootOverride)
      : input.developmentMode
        ? developmentDataRoot
        : path.join(input.documentsDirectory, 'Linnya'),
    workspaceRootIsCustom: Boolean(workspaceRootOverride),
  });
}
