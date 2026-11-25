/** pnpm 的包图不包含根 Vitest 直接读取的插件源码。这里登记这些 Host 合同以及包自己的额外构建。 */
interface PluginCiTarget {
  readonly hostTests: readonly string[];
  readonly preparation: readonly (readonly string[])[];
  readonly regressionWorkflow?: string;
}

const host = 'packages/plugins/__tests__/';
const documentHostTests = [`${host}rendererPluginBoundary`, `${host}workspaceFileToolsIntegration`];
const databaseUpgrade = `${host}databaseUpgrade.sqlite`;

export const pluginCiTargets = new Map<string, PluginCiTarget>([
  ['slides', {
    preparation: [['run', 'codegen-first:check'], ['run', 'smoke:plugin:slides:artifact']],
    hostTests: [
      ...documentHostTests, databaseUpgrade, `${host}agentToolSchema`, `${host}workspaceVfsIntegration`,
      'scripts/__tests__/slides-skill-contract', 'scripts/codegen/layoutDts/__tests__/factorySignatures',
    ],
  }],
  ['knowledge', {
    preparation: [['run', 'smoke:plugin:knowledge:artifact']],
    hostTests: [
      databaseUpgrade, `${host}knowledge`, `${host}emptyProjectDeletion`,
      'src/plugin-sdk/backend/worker/__tests__/documentParsingWorker',
      'apps/renderer/app/plugins/testing/knowledgeProjectCreation',
      'src/app-hosts/linnya/desktop-capabilities/features/renderer-integration-rpc/__tests__/rendererIntegrationRpc',
    ],
  }],
  ['decision', {
    preparation: [['run', 'build:schemas'], ['--filter', '@plugin/decision', 'run', 'build']],
    hostTests: [`${host}decision`],
  }],
  ['canvas', {
    // 三平台工作流已含此包的 lint、类型、业务、实际 Worker、图像与隔离产物门禁。
    regressionWorkflow: 'canvas-regression',
    preparation: [['run', 'build:schemas']],
    hostTests: documentHostTests,
  }],
]);

/** 每项都是 pnpm 的 argv，本地与 PR 在同一入口执行，首个失败保留退出状态。 */
export function pluginOwnerCommands(plugin: string): readonly (readonly string[])[] {
  const target = pluginCiTargets.get(plugin);
  if (!target) throw new Error(`尚未登记插件门禁：${plugin}`);
  const owner = ['--filter', `@plugin/${plugin}`, 'run'];
  const checks = target.regressionWorkflow ? [] : [
    ['exec', 'eslint', '--max-warnings', '0', `packages/plugins/${plugin}/src`],
    [...owner, 'typecheck'],
    [...owner, 'test'],
  ];
  return [
    ['install', '--frozen-lockfile'],
    ['run', 'guard:agent-boundary'],
    ['run', 'guard:plugin-table-ownership'],
    ['run', 'guard:host-plugin-id'],
    ...target.preparation,
    ...checks,
    ['run', 'build:wasm'],
    ['exec', 'vitest', 'run', `${host}host-types-contract`, ...target.hostTests],
  ];
}
