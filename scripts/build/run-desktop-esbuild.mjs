import { build, context, version } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { desktopEsbuildTargets } from './definitions/desktopEsbuildTargets.mjs';
import { isBundleTraceEnabled, writeEsbuildBundleTrace } from './bundle-trace/functions/bundleBuildTrace.mjs';

const [target, ...flags] = process.argv.slice(2);
const options = desktopEsbuildTargets[target];
if (!options) throw new Error(`未知 Desktop build target: ${target}`);
for (const flag of flags) {
  if (flag !== '--watch' && flag !== '--sourcemap=inline') throw new Error(`不支持的 Desktop build flag: ${flag}`);
}
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const configuration = {
  ...options,
  bundle: true,
  sourcemap: flags.includes('--sourcemap=inline') ? 'inline' : false,
  metafile: isBundleTraceEnabled(),
  plugins: [{
    name: 'desktop-build-completion',
    setup(builder) {
      builder.onEnd(result => {
        if (result.errors.length > 0) {
          process.send?.({ type: 'build-error' });
          return;
        }
        if (result.metafile) {
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
  await build(configuration);
}
