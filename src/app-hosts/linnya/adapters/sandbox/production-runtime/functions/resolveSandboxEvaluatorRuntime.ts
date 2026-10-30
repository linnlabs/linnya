import { stat } from 'node:fs/promises';
import path from 'node:path';

import runtimeCatalogSource from '../../../../../../../config/headless-node-runtime.json';
import {
  parseHeadlessNodeRuntimeCatalog,
  resolveHeadlessNodeRuntime,
} from 'src/infra/adapters/headless-node-runtime';
import type {
  SandboxEvaluatorRuntime,
} from '../definitions/sandboxEvaluatorRuntime';

const SANDBOX_EVALUATOR_BUNDLE_FILE_NAME = 'sandboxEvaluatorProcess.cjs';

/**
 * App Host 只组合 Profiled Code Sandbox evaluator entry 与公共 headless Node runtime。
 * runtime 的版本/完整性不再属于 Sandbox domain，也不会阻止 App Server/Command 共用物理 distribution。
 */
export async function resolveSandboxEvaluatorRuntime(input: {
  readonly packaged: boolean;
  readonly resourcesPath: string;
  readonly mainBundleDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly hostEnvironment: NodeJS.ProcessEnv;
}): Promise<SandboxEvaluatorRuntime> {
  const catalog = parseHeadlessNodeRuntimeCatalog(runtimeCatalogSource);
  const runtimeDirectory = input.packaged
    ? path.join(
        input.resourcesPath,
        'headless-node-runtime',
        input.platform,
        input.architecture,
      )
    : path.resolve(
        input.mainBundleDirectory,
        '..',
        '..',
        'extraResources',
        'headless-node-runtime',
        input.platform,
        input.architecture,
      );
  const entryPath = input.packaged
    ? path.join(
        input.resourcesPath,
        'sandbox-runtime',
        'evaluator',
        SANDBOX_EVALUATOR_BUNDLE_FILE_NAME,
      )
    : path.join(
        input.mainBundleDirectory,
        'sandbox',
        SANDBOX_EVALUATOR_BUNDLE_FILE_NAME,
      );
  const runtime = await resolveHeadlessNodeRuntime({
    catalog,
    runtimeDirectory,
    platform: input.platform,
    architecture: input.architecture,
    verifyPreparedExecutableIntegrity: !input.packaged,
  });
  const entryStat = await stat(entryPath);
  if (!entryStat.isFile() || entryStat.size <= 0) {
    throw new Error('Sandbox evaluator bundle 不是非空普通文件');
  }
  const environment: Record<string, string> = {};
  if (input.platform === 'win32') {
    const windowsRoot = Object.entries(input.hostEnvironment).find(
      ([name]) => name.toLowerCase() === 'systemroot',
    )?.[1];
    if (!windowsRoot) throw new Error('Windows Sandbox evaluator requires SystemRoot');
    // Node 的 Windows 随机数初始化依赖系统目录；空环境会在执行 evaluator 前 CSPRNG abort。
    // 仅携带这项 OS 事实，不把 Host 凭据、NODE_OPTIONS 或命令 PATH 传入代码沙箱。
    environment.SystemRoot = windowsRoot;
  }
  return Object.freeze({
    nodeVersion: runtime.nodeVersion,
    manifestPath: runtime.manifestPath,
    launch: Object.freeze({
      executablePath: runtime.executablePath,
      entryPath,
      environment: Object.freeze(environment),
    }),
  });
}
