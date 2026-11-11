import { listWorkingTreePaths } from '../source-analysis/listWorkingTreePaths';
/** Renderer 状态依赖只减不增：shared 不依赖业务值，store 不反向调用编排。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSourceImports } from '../source-analysis/readSourceImports';
import { resolveLocalSourceImport } from './module-barrel-boundary-guard';

const BASELINE = '.baseline/renderer-state-boundary.txt';

export function findRendererStateEdges(file: string, content: string): string[] {
  return readSourceImports(file, content).flatMap(edge => {
    if (edge.typeOnly) return [];
    const target = resolveLocalSourceImport(file, edge.specifier);
    if (!target) return [];
    const rules: string[] = [];
    if (file.startsWith('apps/renderer/shared/') && target.startsWith('apps/renderer/domains/'))
      rules.push('SHARED-TO-DOMAIN');
    if (/\/(?:store|stores)\//u.test(file) && /\/orchestration(?:\/|$)/u.test(target))
      rules.push('STORE-TO-ORCHESTRATION');
    return rules.map(rule => `${rule}\t${file}\t${edge.specifier}`);
  });
}

export function compareRendererStateEdges(
  current: readonly string[],
  baseline: readonly string[]
): { added: string[]; removed: string[] } {
  return {
    added: current.filter(edge => !baseline.includes(edge)),
    removed: baseline.filter(edge => !current.includes(edge)),
  };
}

function main(): void {
  const files = listWorkingTreePaths();
  const current = [
    ...new Set(
      files
        .filter(
          file =>
            file.startsWith('apps/renderer/') &&
            /\.(?:ts|tsx|js|vue)$/u.test(file) &&
            !/(?:__tests__|fixtures)\/|\.(?:test|spec)\./u.test(file)
        )
        .flatMap(file => findRendererStateEdges(file, fs.readFileSync(file, 'utf8')))
    ),
  ].sort();
  const args = new Set(process.argv.slice(2));
  if (args.has('--initialize') && !fs.existsSync(BASELINE)) {
    fs.writeFileSync(BASELINE, `${current.join('\n')}\n`);
    console.log(`Initialized renderer state baseline: ${current.length} edges`);
    return;
  }
  const baseline = fs
    .readFileSync(BASELINE, 'utf8')
    .split('\n')
    .filter(line => line && !line.startsWith('#'));
  const diff = compareRendererStateEdges(current, baseline);
  if (diff.added.length) {
    console.error(
      `新增了反向依赖：\n${diff.added.join('\n')}\nshared 的业务能力归 domain/app；异步用例调用同步 store action，store 不调用 orchestration。`
    );
    process.exitCode = 1;
    return;
  }
  if (args.has('--update')) fs.writeFileSync(BASELINE, `${current.join('\n')}\n`);
  console.log(
    `Renderer state boundary passed: ${current.length} edges, reduced ${diff.removed.length}`
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
