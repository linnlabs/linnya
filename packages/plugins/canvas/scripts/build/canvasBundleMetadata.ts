import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin } from 'esbuild';

/** 三个并行tsup entry各有独立元数据，不能写同一个metafile-cjs.json互相覆盖。 */
export function canvasBundleMetadata(name: 'backend' | 'cli' | 'computation'): Plugin {
  return { name: `canvas-${name}-metadata`, setup(build) {
    build.initialOptions.metafile = true;
    build.onEnd(async result => {
      if (result.errors.length) return;
      if (!result.metafile) throw new Error(`canvas_${name}_metafile_missing`);
      const directory = path.resolve('dist/.metadata'); await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `${name}.json`), JSON.stringify({ workingDirectory: process.cwd(), metafile: result.metafile }));
    });
  } };
}
