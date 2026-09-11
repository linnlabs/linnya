import path from 'node:path';

/** 开发构建顺序；具体编译参数仍由原来的 package/config owner 持有。 */
export function createElectronDevelopmentBuilds({ repositoryRoot, pnpmCli, plugins }) {
  const configuredBuild = path.join(repositoryRoot, 'scripts/development/orchestration/watchConfiguredBuild.mjs');
  const script = (id, name, dependencies = []) => ({
    id, dependencies, cwd: repositoryRoot, file: process.execPath, args: [pnpmCli, 'run', name], watch: false,
  });
  const configured = (id, builder, config, dependencies, cwd = repositoryRoot, after = []) => ({
    id, dependencies, cwd, file: configuredBuild, args: [builder, config, ...after], watch: true,
  });
  const backendDependencies = ['schemas', 'provider-catalog'];
  return [
    script('qdrant-runtime', 'prepare:qdrant-runtime'),
    script('node-runtime', 'prepare:headless-node-runtime'),
    script('wasm', 'build:wasm'),
    script('plugin-cli-client', 'build:plugin-cli-client'),
    script('measurement-assets', 'copy:measurement-worker-assets'),
    {
      id: 'schemas', cwd: path.join(repositoryRoot, 'packages/schemas'), dependencies: [], watch: true,
      file: path.join(repositoryRoot, 'packages/schemas/scripts/watch-runtime.cjs'), args: [],
    },
    configured('provider-catalog', 'tsup', 'tsup.config.ts', ['schemas'], path.join(repositoryRoot, 'packages/provider-catalog')),
    ...['main', 'preload', 'measurement-worker', 'measurement-preload'].map(target => ({
      id: target, cwd: repositoryRoot, dependencies: backendDependencies, watch: true,
      file: path.join(repositoryRoot, 'scripts/build/run-desktop-esbuild.mjs'),
      args: [target, '--watch', '--sourcemap=inline'],
    })),
    configured('backend', 'tsup', 'tsup.backend.config.ts', backendDependencies, repositoryRoot, ['scripts/build/prepare-backend-runtime.cjs']),
    configured('worker', 'tsup', 'tsup.worker.config.ts', [...backendDependencies, 'wasm']),
    configured('sandbox-runner', 'tsup', 'tsup.sandbox-runner.config.ts', backendDependencies),
    configured('command-runner', 'tsup', 'tsup.command-runner.config.ts', backendDependencies),
    ...plugins.map(plugin => configured(
      `plugin-${plugin.pluginId}`, 'tsup', plugin.backendWatchConfig, backendDependencies, plugin.packageDir,
    )),
    configured('slides-raster-worker', 'vite', 'vite.raster-worker.config.mts', ['schemas'], path.join(repositoryRoot, 'packages/plugins/slides')),
    configured('slides-brush-worker', 'vite', 'vite.brush-worker.config.mts', ['schemas'], path.join(repositoryRoot, 'packages/plugins/slides')),
    // CLI bridge 共享 backend 中的 MathJax runtime，按 owner 完成顺序构建。
    script('slides-cli', 'build:slides-cli', ['plugin-slides']),
    script('backend-boundary', 'guard:app-server-backend-boundary', ['backend']),
    script('backend-dom', 'guard:backend-dom-runtime', ['backend']),
    script('backend-ai-sdk', 'guard:backend-ai-sdk-runtime', ['backend']),
    script('backend-web-render', 'guard:backend-web-render-boundary', ['backend']),
    script('worker-boundary', 'guard:worker-bundle', ['worker']),
    script('sqlite-runtime', 'guard:better:electron'),
  ];
}
