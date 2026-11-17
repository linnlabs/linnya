import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'esbuild';

/** 真实构建图留在非发行目录，供 Worker 闭包检查；不把 metafile 放进插件 ZIP。 */
export function knowledgeBundleMetadata(name: string): Plugin {
  return { name: `knowledge-${name}-metadata`, setup(build) {
    build.initialOptions.metafile = true;
    build.onEnd(async result => {
      if (result.errors.length) return;
      if (!result.metafile) throw new Error(`knowledge ${name} 缺少构建图`);
      const directory = path.resolve('dist/.metadata');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${name}.json`), JSON.stringify({ workingDirectory: process.cwd(), metafile: result.metafile }));
    });
  } };
}
