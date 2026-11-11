import { build } from 'esbuild';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = path.join(packageRoot, 'dist');
const foundationEntry = path.resolve(packageRoot, '../foundation/src/index.ts');

/** 保留 Schemas 的多入口模块身份，只把无运行依赖的基础函数编进实际消费者。 */
const inlineFoundationPlugin = {
  name: 'schemas-inline-foundation',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^@linnya\/foundation$/ }, () => ({ path: foundationEntry }));
    buildContext.onResolve({ filter: /^\.{1,2}\// }, args => {
      if (args.importer.startsWith(`${distRoot}${path.sep}`)) return { path: args.path, external: true };
      return undefined;
    });
  },
};

let count = 0;
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.name.endsWith('.js') && (await readFile(file, 'utf8')).includes('@linnya/foundation')) {
      const output = await build({
        entryPoints: [file], bundle: true, write: false, platform: 'neutral',
        format: path.relative(distRoot, file).startsWith(`esm${path.sep}`) ? 'esm' : 'cjs',
        external: ['zod', 'semver'], plugins: [inlineFoundationPlugin],
      });
      await writeFile(file, output.outputFiles[0].contents);
      count++;
    }
  }
}
await visit(distRoot);
console.log(`[schemas] inlined foundation in ${count} runtime modules`);
