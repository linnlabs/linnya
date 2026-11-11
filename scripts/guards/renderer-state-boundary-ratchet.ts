import { listWorkingTreePaths } from '../source-analysis/listWorkingTreePaths';
/** Renderer 状态依赖只减不增：shared 不依赖业务值，store 不反向调用编排。 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { readSourceImports } from '../source-analysis/readSourceImports';
import { resolveLocalSourceImport } from './module-barrel-boundary-guard';

const BASELINE = '.baseline/renderer-state-boundary.txt';
// 已拆分的公开命令入口同样不能被 store 回引，避免只隔一层门面就绕过流程方向。
const STORE_FLOW_ENTRY_POINTS = new Set([
  'apps/renderer/domains/knowledgebase/runtime',
  'apps/renderer/domains/knowledgebase/features/graph-progress/runtime',
  'apps/renderer/domains/workspace/tree',
  'apps/renderer/domains/workspace/features/todo/runtime',
  'apps/renderer/app/update/runtime',
  'apps/renderer/domains/editor/features/BlockHistory/runtime',
  'apps/renderer/domains/editor/features/Review/runtime',
  'apps/renderer/domains/editor/blocks/LatexBlock/runtime',
  'apps/renderer/domains/editor/blocks/AudioBlock/runtime',
  'apps/renderer/domains/conversation/assistantActions',
  'apps/renderer/domains/conversation/projectionActions',
  'apps/renderer/domains/conversation/projection',
  'apps/renderer/domains/conversation/history/loader',
  'apps/renderer/domains/conversation/history/list',
]);

export function findRendererStateEdges(file: string, content: string): string[] {
  const dependencies = readSourceImports(file, content).flatMap(edge => {
    if (edge.typeOnly) return [];
    const target = resolveLocalSourceImport(file, edge.specifier);
    if (!target) return [];
    const rules: string[] = [];
    if (file.startsWith('apps/renderer/shared/') && target.startsWith('apps/renderer/domains/'))
      rules.push('SHARED-TO-DOMAIN');
    if (/\/(?:store|stores)\//u.test(file) && (
      /\/orchestration(?:\/|$)/u.test(target)
      || STORE_FLOW_ENTRY_POINTS.has(target.replace(/\.[cm]?[jt]s$/u, ''))
    ))
      rules.push('STORE-TO-ORCHESTRATION');
    return rules.map(rule => `${rule}\t${file}\t${edge.specifier}`);
  });
  return [...dependencies, ...findStoreAsyncImplementations(file, content)];
}

/** 按函数身份计存量，改行号不会失效；不能把新 async 写在 store 内绕过导入方向门禁。 */
function findStoreAsyncImplementations(file: string, content: string): string[] {
  if (!/\/(?:store|stores)\//u.test(file) || file.endsWith('.vue')) return [];
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const counts = new Map<string, number>();
  function visit(node: ts.Node): void {
    if (ts.isFunctionLike(node) && node.body && ts.canHaveModifiers(node)
      && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      const parent = node.parent;
      const name = node.name?.getText(source)
        ?? (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) ? parent.name.getText(source) : '<anonymous>');
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...counts].flatMap(([name, count]) => Array.from({ length: count }, (_, index) =>
    `STORE-ASYNC\t${file}\t${name}#${index + 1}`));
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
      `新增了状态边界违规：\n${diff.added.join('\n')}\nshared 的业务能力归 domain/app；异步用例调用同步 store action，store 不调用 orchestration，也不自行实现 async 流程。`
    );
    process.exitCode = 1;
    return;
  }
  if (args.has('--update')) fs.writeFileSync(BASELINE, `${current.join('\n')}\n`);
  console.log(
    `Renderer state boundary passed: ${current.filter(item => !item.startsWith('STORE-ASYNC\t')).length} reverse dependencies, ${current.filter(item => item.startsWith('STORE-ASYNC\t')).length} async implementations, reduced ${diff.removed.length}`
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main();
