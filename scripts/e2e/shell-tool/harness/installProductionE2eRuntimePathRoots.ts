import { installRuntimePathRoots } from '../../../../src/shared/runtime-paths';

/**
 * 生产 Shell 夹具必须像真实 Desktop Host 一样，在任何 Agent 组合访问持久化路径前安装唯一路径事实。
 */
export function installProductionE2eRuntimePathRoots(input: {
  readonly runRoot: string;
  readonly appDataRoot: string;
}): void {
  installRuntimePathRoots({
    developmentRoot: input.runRoot,
    appDataRoot: input.appDataRoot,
    workspaceRoot: input.appDataRoot,
    workspaceRootIsCustom: false,
  });
}
