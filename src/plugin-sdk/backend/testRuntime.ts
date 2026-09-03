/**
 * @file testRuntime.ts
 * @description 插件 backend 集成测试的 Host 组合入口。
 *
 * 中文说明：插件测试只能依赖这个窄入口，不能直接操作 Host 的 registry 全局状态。
 * 生产插件代码不得导入本模块；真实 App 运行态仍由应用组合根安装。
 */

import type { PluginHostTestRuntimeOptions } from '@linnya/plugin-host-contract/backend/testRuntime';
import {
  clearPluginRuntimeStateForTests,
  setPluginRuntimeStateForTests,
} from 'src/app-hosts/linnya/plugin-registry/pluginRuntimeState';
import {
  clearWorkspaceMutationPublisherForTesting,
  installWorkspaceMutationPublisher,
} from 'src/features/workspace/orchestration/workspaceMutationPublisherRegistry';

const ignoreWorkspaceMutation = (): void => undefined;

export type { PluginHostTestRuntimeOptions } from '@linnya/plugin-host-contract/backend/testRuntime';

export function installPluginHostTestRuntime(
  options: PluginHostTestRuntimeOptions,
): void {
  setPluginRuntimeStateForTests(options);
  installWorkspaceMutationPublisher(ignoreWorkspaceMutation);
}

export function resetPluginHostTestRuntime(): void {
  clearWorkspaceMutationPublisherForTesting();
  clearPluginRuntimeStateForTests();
}
