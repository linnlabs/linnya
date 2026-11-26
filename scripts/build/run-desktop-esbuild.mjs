import { build, context, version } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { desktopEsbuildTargets } from './definitions/desktopEsbuildTargets.mjs';
import { isBundleTraceEnabled, writeEsbuildBundleTrace } from './bundle-trace/functions/bundleBuildTrace.mjs';
import { findDesktopMainBundleViolations } from './functions/desktopMainBundleBoundary.mjs';

const [target, ...flags] = process.argv.slice(2);
const options = desktopEsbuildTargets[target];
if (!options) throw new Error(`未知 Desktop build target: ${target}`);
for (const flag of flags) {
  if (flag !== '--watch' && flag !== '--sourcemap=inline') throw new Error(`不支持的 Desktop build flag: ${flag}`);
}
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const configuration = {
  ...options,
  ...(target === 'main' ? { define: { LINNYA_DESKTOP_BUILD_TIME: String(Date.now()) } } : {}),
  bundle: true,
  sourcemap: flags.includes('--sourcemap=inline') ? 'inline' : false,
  // 主进程包的边界检查读 metafile 的逐模块贡献，所以 main 始终生成。
  metafile: isBundleTraceEnabled() || target === 'main',
  plugins: [{
    name: 'desktop-build-completion',
    setup(builder) {
      builder.onEnd(result => {
        if (result.errors.length > 0) {
          process.send?.({ type: 'build-error' });
          return;
        }
        if (result.metafile && isBundleTraceEnabled()) {
          writeEsbuildBundleTrace({
            buildTarget: process.env.LINNYA_BUNDLE_TRACE_TARGET ?? `esbuild/${options.outfile.toLowerCase()}`,
            metafile: result.metafile,
            repositoryRoot,
            toolVersion: version,
            workingDirectory: process.cwd(),
          });
        }
        process.send?.({ type: 'build-ready' });
      });
    },
  }],
};

if (flags.includes('--watch')) {
  const buildContext = await context(configuration);
  process.on('message', async message => {
    if (message?.type !== 'stop') return;
    await buildContext.dispose();
    process.exit(0);
  });
  process.on('disconnect', () => process.exit(0));
  await buildContext.watch();
} else {
  const result = await build(configuration);
  if (target === 'main') {
    // watch 模式不拦：开发时先让应用起来，正式构建、CI 和打包都走这条非 watch 路径。
    const violations = findDesktopMainBundleViolations(result.metafile.outputs[options.outfile]);
    if (violations.length > 0) throw new Error(`Desktop 主进程包边界失败：\n${violations.join('\n')}`);
  }
}
